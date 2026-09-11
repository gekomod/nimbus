import importlib.machinery
import importlib.util
import json
import pathlib
import tempfile
import threading
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('disc_jobs', 'services/disc-jobs/nimbus-disc-jobs')
spec = importlib.util.spec_from_loader(loader.name, loader)
w = importlib.util.module_from_spec(spec)
loader.exec_module(w)

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.fstab = pathlib.Path(self.temp.name) / 'fstab'
        self.fstab.write_text('# comment\nUUID=system / ext4 defaults 0 1\n')
        self.e = w.Engine(self.temp.name, self.fstab)

    def tearDown(self):
        self.e.db.close()
        self.temp.cleanup()

    def test_crash_recovery_does_not_repeat_queued_or_running_work(self):
        for state in ('queued', 'running'):
            key = ('a' if state == 'queued' else 'b') * 32
            self.e.submit({'operation': 'rescan'}, key)
            if state == 'running':
                self.e.set(key, state, 'test')
        self.e.db.close()
        self.e = w.Engine(self.temp.name, self.fstab)
        self.assertEqual([j['state'] for j in self.e.rows()], ['interrupted', 'interrupted'])
        self.assertTrue(self.e.q.empty())

    def test_idempotency_returns_same_job_and_rejects_different_request(self):
        request = {'operation': 'rescan'}
        one = self.e.submit(request, 'a'*32)
        self.assertEqual(one, self.e.submit(request, 'a'*32))
        self.assertEqual(self.e.q.qsize(), 1)
        with self.assertRaises(ValueError):
            self.e.submit({'operation': 'unmount', 'target': '/mnt/data'}, 'a'*32)

    def test_unknown_and_internal_operations_are_rejected(self):
        for request in ({'operation': 'shell', 'command': 'mkfs.ext4 /dev/sda'}, {'operation': 'rescan', '_identities': []}):
            with self.assertRaises(ValueError):
                self.e.submit(request, 'a'*32)
        self.assertEqual(self.e.rows(), [])

    def test_command_rpc_rejects_mutating_modes_and_shell(self):
        with patch.object(w, 'run') as run:
            for argv in (['bash', '-c', 'id'], ['zpool', 'destroy', 'tank'], ['smartctl', '-t', 'long', '/dev/sda'], ['blkid', '-w', '/etc/fstab'], ['ssacli','ctrl','slot=0','delete','forced'], ['findmnt','--tab-file','/etc/shadow']):
                with self.assertRaises(ValueError):
                    self.e.read({'operation': 'read.command', 'argv': argv})
            run.assert_not_called()

    def test_controller_and_smart_reads_use_shared_cache(self):
        with patch.object(w, 'run', return_value='report') as run:
            for argv in (['ssacli','ctrl','slot=0','pd','all','show','detail'], ['smartctl','-a','-j','-d','cciss,12','/dev/sda']):
                for _ in range(2):
                    self.assertEqual(self.e.read({'operation':'read.command','argv':argv})['output'], 'report')
            self.assertEqual(run.call_count, 2)

    def test_identity_change_rejected(self):
        expected = {'path':'/dev/disk/by-id/wwn-A','serials':['A'],'size':100,'type':'disk','uuid':None}
        with patch.object(w, 'identity', return_value={**expected,'serials':['B']}):
            with self.assertRaisesRegex(ValueError, 'zmieniła'):
                w.assert_identity(expected)

    def test_system_disk_and_members_rejected_before_format(self):
        for fs, mounts in [('ext4',['/']), ('ext4',['/mnt/data']), ('zfs_member',[]), ('LVM2_member',[]), ('swap',['[SWAP]'])]:
            nodes=[{'path':'/dev/sda','type':'disk','children':[{'path':'/dev/sda1','fstype':fs,'mountpoints':mounts}]}]
            with patch.object(w, 'inventory', return_value=nodes), patch.object(w, 'run') as run:
                with self.assertRaises(ValueError):
                    self.e.execute({'operation':'format','fs':'ext4'}, ['/dev/sda'])
                run.assert_not_called()

    def test_existing_holders_protect_disk(self):
        with patch.object(w, 'inventory', return_value=[{'path':'/dev/sda','type':'disk'}]), patch.object(w.glob, 'glob', return_value=['dm-0']):
            with self.assertRaises(ValueError):
                w.unused('/dev/sda')

    def test_format_uses_argument_array_and_retains_error(self):
        with patch.object(w, 'unused'), patch.object(w, 'run', side_effect=ValueError('mkfs failed')) as run:
            with self.assertRaisesRegex(ValueError, 'mkfs failed'):
                self.e.execute({'operation':'format','fs':'ext4','label':'data'}, ['/dev/sdb'])
            self.assertEqual(run.call_args.args[0], ['mkfs.ext4','-F','-L','data','/dev/sdb'])

    def test_partition_does_not_replace_non_gpt_table(self):
        with patch.object(w,'unused'), patch.object(w,'run',return_value=json.dumps({'partitiontable':{'label':'dos'}})) as run:
            with self.assertRaisesRegex(ValueError,'GPT'):
                self.e.execute({'operation':'partition.create','start_mib':1,'end_mib':100}, ['/dev/sdb'])
            self.assertEqual(run.call_count,1)

    def test_fstab_edit_preserves_other_mounts_comments_and_escaped_spaces(self):
        content='# keep\nUUID=a /mnt/one ext4 defaults 0 2\nUUID=a /mnt/two\\040words ext4 defaults 0 2\n'
        edited=w.edit_fstab(content,'/mnt/two words')
        self.assertIn('/mnt/one',edited)
        self.assertNotIn('two',edited)
        self.assertIn('# keep',edited)
        edited=w.edit_fstab(edited,'/mnt/two words',['UUID=a','/mnt/two words','ext4','defaults','0','2'])
        self.assertIn('/mnt/two\\040words',edited)

    def test_fstab_conflict_and_validation_failure_leave_original(self):
        original=self.fstab.read_text()
        with self.assertRaises(ValueError):
            self.e.save_fstab('new','stale')
        with patch.object(self.e,'verify_fstab',side_effect=ValueError('invalid')):
            with self.assertRaises(ValueError):
                self.e.save_fstab('new',original)
        self.assertEqual(self.fstab.read_text(),original)

    def test_fstab_success_has_backup_and_apply_error_is_truthful(self):
        original=self.fstab.read_text()
        updated=original+'UUID=data /mnt/data ext4 defaults 0 2\n'
        with patch.object(self.e,'verify_fstab',return_value='verified'), patch.object(w,'run',side_effect=ValueError('mount failed')):
            result=self.e.execute({'operation':'fstab.save','original':original,'content':updated,'apply':True},[])
        self.assertTrue(result['saved'])
        self.assertFalse(result['applied'])
        self.assertIn('mount failed',result['error'])
        self.assertEqual(self.fstab.read_text(),updated)
        self.assertEqual(next(pathlib.Path(self.temp.name).glob('fstab-*.bak')).read_text(),original)

    def test_zfs_no_forced_create_or_recursive_rollback(self):
        with patch.object(w,'unused'), patch.object(w,'run',return_value='ok') as run:
            self.e.execute({'operation':'zfs.create','name':'tank','raid_type':'mirror'}, ['/dev/sdb','/dev/sdc'])
            self.assertNotIn('-f',run.call_args.args[0])
            self.e.execute({'operation':'zfs.rollback','snapshot':'tank/data@before'},[])
            self.assertNotIn('-r',run.call_args.args[0])

    def test_mount_rejects_symlink_to_system(self):
        link=pathlib.Path(self.temp.name)/'link'
        link.symlink_to('/etc')
        with self.assertRaises(ValueError):
            w.target_path(str(link))

    def test_busy_hardware_does_not_block_job_history(self):
        acquired=threading.Event();release=threading.Event()
        def hold():
            with self.e.hardware:
                acquired.set();release.wait(5)
        t=threading.Thread(target=hold);t.start();acquired.wait(1)
        try:
            self.assertEqual(self.e.rows(),[])
            self.assertEqual(self.e.submit({'operation':'rescan'},'a'*32)['state'],'queued')
        finally:
            release.set();t.join()


class SocketTests(unittest.TestCase):
    @unittest.skipUnless(w.os.getuid() == 0, 'production socket requires root peer')
    def test_socket_submission_completion_history_and_drain(self):
        import http.client
        import socket
        import time
        with tempfile.TemporaryDirectory() as directory:
            engine = w.Engine(directory)
            path = directory + '/jobs.sock'
            class Local(http.client.HTTPConnection):
                def connect(self):
                    self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                    self.sock.settimeout(2)
                    self.sock.connect(path)
            try:
                listener = w.Server(path, w.Handler)
            except PermissionError:
                engine.db.close()
                self.skipTest('environment denies Unix socket creation')
            with listener as server, patch.object(engine, 'execute', return_value={'status':'ok','output':'simulated operation'}):
                server.engine = engine
                threading.Thread(target=server.serve_forever, daemon=True).start()
                threading.Thread(target=engine.work, daemon=True).start()
                def request(method, url, data=None):
                    c = Local('localhost')
                    c.request(method, url, json.dumps(data) if data is not None else None, {'Idempotency-Key':'c'*32})
                    r=c.getresponse();result=(r.status,json.load(r));c.close();return result
                try:
                    self.assertEqual(request('GET','/health')[0],200)
                    status,job=request('POST','/jobs',{'operation':'rescan'})
                    self.assertEqual(status,202)
                    for _ in range(100):
                        status,job=request('GET','/jobs/'+'c'*32)
                        if job['state']=='succeeded':break
                        time.sleep(.01)
                    self.assertEqual(job['state'],'succeeded')
                    self.assertEqual(job['result']['output'],'simulated operation')
                    self.assertEqual(len(request('GET','/jobs')[1]['jobs']),1)
                    self.assertEqual(request('POST','/drain')[0],200)
                    self.assertEqual(request('POST','/jobs',{'operation':'rescan'})[0],400)
                finally:
                    server.shutdown()
                    engine.db.close()

if __name__=='__main__':
    unittest.main()
