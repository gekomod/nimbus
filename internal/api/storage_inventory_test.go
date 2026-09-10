package api

import (
 "strings"
 "testing"
 "nimbus/internal/sys"
)

func TestStorageSCSISMARTIsNotDiscarded(t *testing.T) {
 data:=parseStorageSMARTSummary(`{"device":{"protocol":"SCSI"},"smart_status":{"passed":false},"temperature":{"current":38},"power_on_time":{"hours":1200},"scsi_grown_defect_list":3}`)
 if data==nil || data["status"]!="warn" || data["temp"]!=float64(38) || data["hours"]!=float64(1200) {t.Fatalf("lost SCSI health: %+v",data)}
}
func TestStorageNormalizedATAValueIsNotTemperature(t *testing.T) {
 data:=parseStorageSMARTSummary(`{"smart_status":{"passed":true},"ata_smart_attributes":{"table":[{"id":194,"value":150}]}}`)
 if data==nil || data["temp"]!=0 {t.Fatalf("invented temperature: %+v",data)}
 if parseStorageSMARTSummary(`{"smartctl":{"messages":[{"string":"Unable to detect device type"}]}}`)!=nil {t.Fatal("error became a healthy disk")}
}
func TestStorageMountedDescendantDoesNotDependOnDiskName(t *testing.T) {
 disk:=map[string]interface{}{"name":"nvme0n1","children":[]interface{}{map[string]interface{}{"name":"nvme0n1p2","children":[]interface{}{map[string]interface{}{"name":"vg-data","mountpoint":"/srv/data"}}}}}
 if !blockTreeMounted(disk) {t.Fatal("mounted mapper descendant was lost")}
}
func TestStorageSeparateDataPartitionRemainsVisible(t *testing.T) {
 system:=map[string]bool{"/dev/nimbus-test-disk":true,"/dev/nimbus-test-root":true}
 if !mountIsDataPool(sys.MountPoint{Device:"/dev/nimbus-test-data",MountAt:"/mnt/data",FS:"ext4"},system) {t.Fatal("data partition hidden")}
 if mountIsDataPool(sys.MountPoint{Device:"/dev/nimbus-test-root",MountAt:"/mnt/root-copy",FS:"ext4"},system) {t.Fatal("root filesystem shown as data pool")}
}
func TestStorageFstabEscapesAndTargetOnlyRemoval(t *testing.T) {
 before:="UUID=data /mnt/first ext4 defaults 0 2\nUUID=data /mnt/second ext4 defaults 0 2\n"
 after:=updateFstabEntry(before,"/dev/sdb1","/mnt/first","data","","",false)
 if strings.Contains(after,"/mnt/first")||!strings.Contains(after,"/mnt/second") {t.Fatalf("other mount changed: %s",after)}
 encoded:=updateFstabEntry("","/dev/sdb1","/mnt/my data","data","ext4","defaults",true)
 if !strings.Contains(encoded,`/mnt/my\040data`) {t.Fatalf("unescaped fstab target: %s",encoded)}
 if !fstabHasMount(parseFstab(encoded),"/dev/sdb1","/mnt/my data","data") {t.Fatal("escaped target not recognized")}
}

func TestStorageFstabTogglePreservesOtherTargetsOnEnable(t *testing.T) {
 before:="UUID=data /mnt/other ext4 defaults 0 2\n"
 after:=updateFstabMount(before,"/dev/sdb1","/mnt/new","data","ext4","defaults",true)
 if !strings.Contains(after,"/mnt/other") || !strings.Contains(after,"/mnt/new") {t.Fatalf("toggle changed another target: %s",after)}
}
