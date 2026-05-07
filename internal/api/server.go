package api

import (
	"encoding/json"
	"net/http"
	"nimbus/internal/auth"
	"nimbus/internal/sys"
	"os"
	"path/filepath"
	"strings"
	"time"
	"fmt"
)

type Config struct {
	Port         int
	WebDir       string
	FallbackUser string
	FallbackPass string
}

type Server struct {
	cfg  Config
	auth *auth.Manager
	mux  *http.ServeMux
}

func NewServer(cfg Config) *Server {
	s := &Server{cfg: cfg, auth: auth.NewManager(cfg.FallbackUser, cfg.FallbackPass), mux: http.NewServeMux()}
	// Utwórz wymagane katalogi przy starcie
	for _, dir := range []string{"/opt/stacks", "/etc/nas-panel"} {
		os.MkdirAll(dir, 0755)
	}
	s.routes()
	go runStartupTasks()
	sys.StartMonitor()
	StartAlertEngine()
	StartMetricsCollector()
	return s
}

func (s *Server) ListenAndServe() error {
	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", s.cfg.Port),
		Handler:           s.ProxyHandler(s.mux),
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1MB
	}
	return srv.ListenAndServe()
}

func (s *Server) routes() {
	// public
	s.mux.HandleFunc("/api/login",             s.handleLogin)
	s.mux.HandleFunc("/api/login/verify-totp", s.handleVerifyTOTP)
	s.mux.HandleFunc("/api/logout",     s.handleLogout)
	s.mux.HandleFunc("/api/check-auth", s.handleCheckAuth)
	s.mux.HandleFunc("/api/status",     s.handlePublicStatus) // bez auth — dla strony logowania
	s.mux.HandleFunc("/network/dynamic-dns/update-all", s.handleDynDNSUpdateAll)

	a := func(p string, fn http.HandlerFunc) { s.mux.HandleFunc(p, s.auth_(fn)) }

	// system
	a("/api/overview", s.handleOverview)
	a("/api/cpu", s.handleCPU)
	a("/api/memory", s.handleMemory)
	a("/api/system-health", s.handleSystemHealth)
	a("/api/system-restart", s.handleSystemRestart)
	a("/api/system-shutdown", s.handleSystemShutdown)
	a("/api/system/schedule-shutdown", s.handleScheduleShutdown)
	a("/api/system/cancel-shutdown", s.handleCancelShutdown)
	a("/api/system/update", s.handleSystemUpdate)
	a("/api/system/schedule-update", s.handleScheduleUpdate)
	a("/api/system/users", s.handleSystemUsers)
	a("/api/system/users/", s.handleSystemUserAction)
	a("/api/system/groups", s.handleGroups)
	a("/api/system/backup/create", s.handleBackupCreate)
	a("/api/system/backup/list", s.handleBackupList)
	a("/api/system/backup/history", s.handleBackupHistory)
	a("/api/system/backup/schedule", s.handleBackupSchedule)
	a("/api/system/backup/delete/", s.handleBackupDelete)
	a("/system/settings", s.handleSystemSettings)
	a("/system/updates/check", s.handleUpdatesCheck)
	a("/system/updates/packages", s.handleUpdatesPackages)
	a("/system/updates/install", s.handleUpdatesInstall)
	a("/system/updates/changelog", s.handleUpdatesChangelog)
	a("/system/updates/details", s.handleUpdatesDetails)
	a("/system/updates/install-log",    s.handleUpdatesInstallLog)
	a("/system/updates/history",        s.handleUpdatesHistory)
	a("/system/updates/auto-config",    s.handleUpdatesAutoConfig)
	a("/system/updates/reboot-required",s.handleUpdatesRebootRequired)
	a("/system/cron-jobs", s.handleCronJobs)
	a("/api/system/cron-ddns", s.handleCronDDNS)
	a("/system/cron-jobs/", s.handleCronJobAction)
	a("/system/webserver-config", s.handleWebserverConfig)
	a("/system/save-webserver-config", s.handleWebserverConfigSave)

	// logs / processes
	a("/api/logs", s.handleLogs)
	a("/api/processes", s.handleProcesses)
	a("/api/system-logs", s.handleSystemLogs)

	// storage
	a("/api/storage/devices", s.handleStorageDevices)
	a("/api/storage/debug-devices", s.handleStorageDebugDevices)
	a("/api/storage/disk-size", s.handleStorageDiskSize)
	a("/api/storage/check-device", s.handleStorageCheckDevice)
	a("/api/storage/rescan", s.handleStorageRescan)
	a("/api/storage/mounts", s.handleMounts)
	a("/api/mounts", s.handleMounts)
	a("/api/storage/mount", s.handleStorageMount)
	a("/api/storage/unmount", s.handleStorageUnmount)
	a("/api/storage/format", s.handleStorageFormat)
	a("/api/storage/fstab", s.handleStorageFstab)
	a("/api/storage/fstab-content", s.handleStorageFstabContent)
	a("/api/storage/save-fstab", s.handleStorageSaveFstab)
	a("/api/storage/edit-fstab", s.handleStorageSaveFstab)
	a("/api/storage/fstab-check", s.handleStorageFstabCheck)
	a("/api/storage/exec-command", s.handleStorageExecCommand)
	a("/api/filesystems/list-directories", s.handleListDirectories)
	a("/api/storage/lvm", s.handleStorageLVM)
	a("/api/storage/lvm-volumes", s.handleStorageLVMVolumes)
	a("/api/storage/scan-lvm", s.handleStorageScanLVM)
	a("/api/storage/raid", s.handleStorageRAID)
	a("/api/storage/raid/start", s.handleStorageRAIDStart)
	a("/api/storage/scan-raid", s.handleStorageScanRAID)
	a("/api/storage/create-raid", s.handleStorageCreateRAID)
	a("/api/storage/smart", s.handleStorageSMART)
	a("/api/storage/smart/monitoring", s.handleStorageSMARTMonitoring)
	a("/api/storage/smart/details/", s.handleStorageSMARTDetails)
	a("/api/storage/smart/diagnostics/", s.handleStorageSMARTDiag)
	a("/api/storage/smart/repair-status/", s.handleStorageSMARTRepairStatus)
	a("/api/storage/smart/test-status/", s.handleStorageSMARTTestStatus)
	a("/api/storage/smart/sector-details/", s.handleStorageSMARTSectorDetails)
	a("/api/storage/smart/repair-bad-sectors", s.handleStorageSMARTAction)
	a("/api/storage/smart/ata-secure-erase", s.handleStorageSMARTAction)
	a("/api/storage/smart/run-extended-test", s.handleStorageSMARTAction)
	a("/api/storage/smart/enable-automatic-offline", s.handleStorageSMARTAction)
	a("/api/storage/smart/fix-load-cycle-count", s.handleStorageSMARTAction)
	a("/api/storage/smart/refresh-attributes", s.handleStorageSMARTAction)
	a("/api/storage/smart/force-reallocation", s.handleStorageSMARTAction)
	a("/api/storage/smart/fix-physical-issues", s.handleStorageSMARTAction)
	a("/api/storage/smart/run-test", s.handleStorageSMARTRunTest)
	a("/api/zfs/pools", s.handleZFSPools)
	a("/api/zfs/snapshots", s.handleZFSSnapshots)
	a("/api/zfs/snapshots/", s.handleZFSSnapshotAction)
	a("/api/zfs/datasets", s.handleZFSDatasets)
	a("/api/zfs/snap-policy", s.handleZFSSnapPolicy)

	// network
	a("/api/network", s.handleNetworkOverview)
	a("/network/interfaces", s.handleNetworkInterfaces)
	a("/network/interfaces/details/", s.handleNetworkInterfaceDetail)
	a("/network/interfaces/add", s.handleNetworkInterfaceAdd)
	a("/network/interfaces/remove/", s.handleNetworkInterfaceRemove)
	a("/network/firewall/status", s.handleFirewallStatus)
	a("/network/firewall/status/", s.handleFirewallStatusAction)
	a("/network/firewall/rules", s.handleFirewallRules)
	a("/network/firewall/rules/", s.handleFirewallRuleDelete)
	a("/network/firewall/stats", s.handleFirewallStats)
	a("/network/iptables/rules", s.handleIPTablesRules)
	a("/network/iptables/rules/", s.handleIPTablesRuleDelete)
	a("/network/docker/debug-rules", s.handleNetDockerDebugRules)
	a("/network/docker/status", s.handleNetDockerStatus)
	a("/network/docker/install-ufw-docker", s.handleNetDockerInstallUFW)
	a("/network/docker/containers", s.handleNetDockerContainers)
	a("/network/docker/ufw-rule", s.handleNetDockerUFWRule)
	a("/network/docker/ufw-rules", s.handleNetDockerUFWRules)
	a("/network/speedtest/status", s.handleSpeedtestStatus)
	a("/network/speedtest/install", s.handleSpeedtestInstall)
	a("/network/speedtest/servers", s.handleSpeedtestServers)
	a("/network/speedtest/quick", s.handleSpeedtestQuick)
	// Fail2Ban
	a("/api/system/fail2ban-status", s.handleFail2BanStatus)

	// Network detail — bandwidth, container traffic, firewall
	a("/api/network/bandwidth",       s.handleNetworkBandwidth)
	a("/api/network/containers",      s.handleContainerNetwork)
	a("/api/network/firewall/rules",  s.handleFirewallRulesDirect)

	// Temperatury i wentylatory
	a("/api/temps",              s.handleTemps)
	a("/api/temps/install",      s.handleTempsInstall)
	a("/api/fans/control",       s.handleFanControl)
	a("/api/fans/auto",          s.handleFanAuto)

	// DHCP
	a("/api/network/dhcp/leases",  s.handleDHCPLeases)
	a("/api/network/dhcp/config",  s.handleDHCPConfig)
	a("/api/network/dhcp/install", s.handleDHCPInstall)

	// DNS
	a("/api/network/dns/status",   s.handleDNSStatus)
	a("/api/network/dns/hosts",    s.handleDNSHosts)
	a("/api/network/dns/upstream", s.handleDNSUpstream)

	a("/network/dynamic-dns", s.handleDynDNS)
	a("/network/dynamic-dns/settings", s.handleDynDNSSettings)
	a("/network/dynamic-dns/install-cron", s.handleDynDNSInstallCron)
	a("/network/dynamic-dns/cron-status", s.handleDynDNSCronStatus)
	a("/network/dynamic-dns/", s.handleDynDNSItem)

	// vpn
	a("/api/vpn/overview", s.handleVPNOverview)
	a("/api/vpn/connections", s.handleVPNConnections)
	a("/api/vpn/statistics", s.handleVPNStatistics)
	a("/api/vpn/logs/", s.handleVPNLogs)
	a("/api/vpn/wireguard-keys/generate", s.handleVPNWGGenKeys)
	a("/api/vpn/wireguard", s.handleVPNWireguard)
	a("/api/vpn/wireguard/", s.handleVPNWireguardIface)
	a("/api/vpn/openvpn", s.handleVPNOpenVPN)
	a("/api/vpn/openvpn/", s.handleVPNOpenVPNItem)
	a("/api/vpn/ipsec", s.handleVPNIPSec)
	a("/api/vpn/ipsec/", s.handleVPNIPSecAction)

	// docker
	a("/services/docker/health", s.handleDockerHealth)
	a("/services/docker/status", s.handleDockerStatus)
	a("/services/docker/start", s.handleDockerStart)
	a("/services/docker/stop", s.handleDockerStop)
	a("/services/docker/restart", s.handleDockerRestart)
	a("/services/docker/install", s.handleDockerInstall)
	a("/services/docker/cleanup", s.handleDockerCleanup)
	a("/services/docker/config", s.handleDockerConfig)
	a("/services/docker/containers", s.handleDockerContainers)
	a("/services/docker/container/create", s.handleDockerContainerCreate)
	a("/services/docker/container/logs/", s.handleDockerContainerLogs)
	a("/services/docker/container/status/", s.handleDockerContainerStatus)
	a("/services/docker/container/", s.handleDockerContainerAction)
	a("/api/docker/inspect/", s.handleDockerInspect)
	a("/api/docker/exec/", s.handleDockerExec)
	a("/services/docker/images", s.handleDockerImages)
	a("/services/docker/images/pull", s.handleDockerImagePull)
	a("/services/docker/images/remove", s.handleDockerImageRemove)
	a("/services/docker/images/search", s.handleDockerImageSearch)
	a("/services/docker/images/inspect/", s.handleDockerImageInspect)
	a("/services/docker/images/history/", s.handleDockerImageHistory)
	a("/services/docker/images/cleanup", s.handleDockerImageCleanup)
	a("/services/docker/networks", s.handleDockerNetworks)
	a("/services/docker/networks/prune", s.handleDockerNetworkPrune)
	a("/services/docker/networks/", s.handleDockerNetworkItem)
	a("/services/docker/volumes", s.handleDockerVolumes)
	a("/services/docker/volumes/stats", s.handleDockerVolumeStats)
	a("/services/docker/volumes/prune", s.handleDockerVolumePrune)
	a("/services/docker/volumes/", s.handleDockerVolumeItem)
	a("/services/docker/compose", s.handleDockerCompose)
	a("/api/docker/compose/create", s.handleDockerComposeCreate)
	a("/services/docker/compose/deploy", s.handleDockerComposeDeploy)
	a("/services/docker/compose_add", s.handleDockerComposeAdd)
	a("/services/docker/compose/", s.handleDockerComposeItem)
	a("/services/docker/stats/batch", s.handleDockerStatsBatch)
	a("/services/docker/stats/container/", s.handleDockerStatsContainer)
	a("/services/docker/auto-update", s.handleDockerAutoUpdate)
	a("/services/docker/auto-update/check", s.handleDockerAutoUpdateCheck)
	a("/services/docker/registry/list", s.handleDockerRegistryList)
	a("/services/docker/registry/login", s.handleDockerRegistryLogin)
	a("/services/docker/backup", s.handleDockerBackup)
	a("/services/docker/backup/list", s.handleDockerBackupList)
	a("/services/docker/backup/restore", s.handleDockerBackupRestore)
	a("/services/docker/backup/schedule", s.handleDockerBackupSchedule)
	a("/services/docker/backup/schedules", s.handleDockerBackupSchedules)
	a("/services/docker/backup/schedule/", s.handleDockerBackupScheduleItem)
	a("/services/docker/builds", s.handleDockerBuilds)
	a("/services/docker/build", s.handleDockerBuild)
	a("/services/docker/build/github", s.handleDockerBuildGitHub)
	a("/services/docker/build/", s.handleDockerBuildItem)
	a("/services/docker/composer/deploy-stream", s.handleDockerComposeStream)
	a("/api/services/config", s.handleServicesConfig)

	// samba
	a("/services/samba/status", s.handleSambaStatus)
	a("/services/samba/toggle", s.handleSambaToggle)
	a("/services/samba/restart", s.handleSambaRestart)
	a("/services/samba/install", s.handleSambaInstall)
	a("/services/samba/settings", s.handleSambaSettings)
	a("/services/samba/settings/homedirs", s.handleSambaHomedirs)
	a("/services/samba/shares", s.handleSambaShares)
	a("/services/samba/shares/", s.handleSambaShareItem)
	a("/services/samba/users", s.handleSambaUsers)
	a("/services/samba/connections", s.handleSambaConnections)
	a("/services/samba/users-list", s.handleSambaUsersList)

	// SSH - zaktualizowane endpointy
	a("/services/ssh/status", s.handleSSHStatus)
	a("/services/ssh/toggle", s.handleSSHToggle)
	a("/services/ssh/config", s.handleSSHConfig)
	a("/services/ssh/keys", s.handleSSHKeys)
	a("/services/ssh/keys/delete", s.handleSSHKeyDelete)
	a("/services/ssh/connections", s.handleSSHConnections)

	// ftp/sftp
	a("/api/services/ftp-sftp/status", s.handleFTPStatus)
	a("/api/services/ftp-sftp/toggle", s.handleFTPToggle)
	a("/api/services/ftp-sftp/config", s.handleFTPConfig)
	a("/api/services/ftp-sftp/shares", s.handleFTPShares)
	a("/api/services/ftp-sftp/users", s.handleFTPUsers)
	a("/api/services/ftp-sftp/create-user", s.handleFTPCreateUser)
	a("/api/services/ftp-sftp/users/", s.handleFTPUserItem)
	a("/api/services/ftp-sftp/connections", s.handleFTPConnections)
	a("/api/services/ftp-sftp/install", s.handleFTPInstall)
	a("/api/services/ftp-sftp/kill-connection", s.handleFTPKillConn)
	a("/api/services/ftp-sftp/repair-config", s.handleFTPRepairConfig)
	a("/api/services/ftp-sftp/test-config", s.handleFTPTestConfig)

	// nfs client
	a("/api/nfs/role", s.handleNFSRole)
	a("/api/nfs/networks", s.handleNFSNetworks)
	a("/api/nfs/mounts", s.handleNFSMounts)
	a("/api/nfs/mount", s.handleNFSMount)
	a("/api/nfs/umount", s.handleNFSUmount)
	a("/api/nfs/scan-network-start", s.handleNFSScanNetStart)
	a("/api/nfs/scan-network-status", s.handleNFSScanNetStatus)
	a("/api/nfs/discover-start", s.handleNFSDiscoverStart)
	a("/api/nfs/discover-status", s.handleNFSDiscoverStatus)
	a("/api/nfs/benchmark", s.handleNFSBenchmark)
	a("/api/nfs/exports/", s.handleNFSExports)
	a("/api/nfs/scan-ip/", s.handleNFSScanIP)

	// nfs server
	a("/api/nfs-server/status", s.handleNFSServerStatus)
	a("/api/nfs-server/toggle", s.handleNFSServerToggle)
	a("/api/nfs-server/exports", s.handleNFSServerExports)
	a("/api/nfs-server/exports/add", s.handleNFSServerExportAdd)
	a("/api/nfs-server/exports/", s.handleNFSServerExportItem)
	a("/api/nfs-server/stats", s.handleNFSServerStats)
	a("/api/nfs-server/logs", s.handleNFSServerLogs)
	a("/api/nfs-server/test",    s.handleNFSServerTest)
	a("/api/nfs-server/clients", s.handleNFSServerClients)
	a("/api/nfs-server/config",  s.handleNFSServerConfig)
	a("/api/nfs-server/install", s.handleNFSServerInstall)

	// webdav
	a("/services/webdav/status", s.handleWebDAVStatus)
	a("/services/webdav/toggle", s.handleWebDAVToggle)
	a("/services/webdav/config", s.handleWebDAVConfig)
	a("/services/webdav/available-disks", s.handleWebDAVDisks)

	// loadbalancer
	a("/services/loadbalancer/status", s.handleLBStatus)
	a("/services/loadbalancer/config", s.handleLBConfig)
	a("/services/loadbalancer/test", s.handleLBTest)
	a("/services/loadbalancer/apply", s.handleLBApply)

	// terminal
	a("/terminal/sessions", s.handleTerminalSessions)
	a("/terminal/sessions/", s.handleTerminalSessionItem)
	a("/terminal/shells", s.handleTerminalShells)
	a("/terminal/preferences", s.handleTerminalPreferences)
	a("/terminal/stats", s.handleTerminalStats)
	a("/terminal/system-info", s.handleTerminalSysInfo)
	a("/terminal/ls", s.handleTerminalLS)
	a("/terminal/cleanup", s.handleTerminalCleanup)

	// diagnostics
	a("/api/diagnostics/system-health", s.handleDiagHealth)
	a("/api/diagnostics/system-logs", s.handleDiagSystemLogs)
	a("/api/diagnostics/system-logs/", s.handleDiagSystemLogFile)
	a("/api/diagnostics/debug-logs", s.handleDiagDebugLogs)
	a("/api/diagnostics/create-test-logs", s.handleDiagCreateTestLogs)
	a("/api/diagnostics/simple-logs", s.handleDiagSimpleLogs)
	a("/api/diagnostics/journal-logs", s.handleDiagJournalLogs)
	a("/api/diagnostics/service-status/", s.handleDiagServiceStatus)
	a("/api/diagnostics/service-control/", s.handleDiagServiceControl)
	a("/api/diagnostics/export-logs", s.handleDiagExportLogs)
	a("/api/diagnostics/nas-panel/errors", s.handleDiagNASErrors)
	a("/api/diagnostics/processes", s.handleDiagProcesses)
	a("/api/diagnostics/remote-logs", s.handleDiagRemoteLogs)
	a("/api/diagnostics/remote-logs/config", s.handleDiagRemoteLogsConfig)
	a("/diagnostics/system-logs", s.handleDiagSystemLogs)
	a("/diagnostics/system-logs/", s.handleDiagSystemLogFile)
	a("/diagnostics/remote-logs/", s.handleDiagRemoteLogItem)
	a("/diagnostics/processes", s.handleDiagProcesses)
	a("/diagnostics/processes/kill", s.handleDiagProcessKill)

	// power / ups / wol
	a("/power/action", s.handlePowerAction)
	a("/power/history", s.handlePowerHistory)
	a("/power/schedules", s.handlePowerSchedules)
	a("/power/schedules/", s.handlePowerScheduleItem)
	a("/energy/status", s.handleEnergyStatus)
	a("/energy/history", s.handleEnergyHistory)
	a("/energy/devices", s.handleEnergyDevices)
	a("/energy/rate", s.handleEnergyRate)
	a("/ups/status", s.handleUPSStatus)
	a("/ups/details", s.handleUPSDetails)
	a("/ups/config", s.handleUPSConfig)
	a("/ups/config/nut", s.handleUPSConfigNUT)
	a("/ups/events", s.handleUPSEvents)
	a("/ups/logs", s.handleUPSLogs)
	a("/ups/service/restart", s.handleUPSServiceRestart)
	a("/ups/test", s.handleUPSTest)
	a("/wakeonlan/config", s.handleWoLConfig)
	a("/wakeonlan/devices", s.handleWoLDevices)
	a("/wakeonlan/devices/", s.handleWoLDeviceItem)
	a("/wakeonlan/wake", s.handleWoLWake)

	// antivirus
	a("/api/antivirus/status", s.handleAVStatus)
	a("/api/antivirus/debug", s.handleAVDebug)
	a("/api/antivirus/virusdb", s.handleAVVirusDB)
	a("/api/antivirus/scan/history", s.handleAVScanHistory)
	a("/api/antivirus/scan/history/", s.handleAVScanHistoryItem)
	a("/api/antivirus/settings", s.handleAVSettings)
	a("/api/antivirus/scan", s.handleAVScan)
	a("/api/antivirus/update", s.handleAVUpdate)
	a("/api/antivirus/threats/", s.handleAVThreatItem)
	a("/api/antivirus/install", s.handleAVInstall)
	a("/api/antivirus/realtime", s.handleAVRealtime)

	// servers (multi-host)
	a("/api/servers", s.handleServers)
	a("/api/servers/", s.handleServerItem)


	// 2FA TOTP
	a("/api/totp/status",  s.handleTOTPStatus)
	a("/api/totp/setup",   s.handleTOTPSetup)
	a("/api/totp/disable", s.handleTOTPDisable)
	a("/api/totp/toggle",  s.handleTOTPGlobalToggle)

	// Metryki historyczne
	a("/api/metrics", s.handleMetrics)

	// Alert fire (dla startup.go)
	a("/api/notifications/fire",          s.handleNotifFire)
	a("/api/notifications/default-rules", s.handleNotifDefaultRules)

	// dashboard — jeden endpoint zamiast 14
	a("/api/dashboard", s.handleDashboard)

	// proxy routes management — nimbus built-in reverse proxy
	a("/api/proxy/routes",  s.handleProxyRoutes)
	a("/api/proxy/routes/", s.handleProxyRouteItem)
	a("/api/proxy/status",  s.handleProxyStatus)
	a("/api/proxy/preview", s.handleProxyPreview)

	// startup tasks
	a("/api/startup/config", s.handleStartupConfig)
	a("/api/startup/log",    s.handleStartupLog)
	a("/api/startup/",       s.handleStartupAction)

	// media - wszystkie endpointy
	a("/api/media/health", s.handleMediaHealth)
	a("/api/media/config", s.handleMediaConfig)           // GET/POST konfiguracja
	a("/api/media/status/all", s.handleMediaStatusAll)    // status wszystkich
	a("/api/media/status/", s.handleMediaStatusSingle)    // status pojedynczego
	a("/api/media/libraries/", s.handleMediaLibraries)    // biblioteki
	a("/api/media/sync", s.handleMediaSync)               // synchronizacja (opcjonalnie)
	a("/api/media/{id}/", s.handleMediaItem)                   // /api/media/:id/:action
	
	// notifications
	a("/api/notifications/channels",  s.handleNotifChannels)
	a("/api/notifications/channels/", s.handleNotifChannelItem)
	a("/api/notifications/rules",     s.handleNotifRules)
	a("/api/notifications/rules/",    s.handleNotifRuleItem)
	a("/api/notifications/history",   s.handleNotifHistory)

	// File manager
	a("/api/files/list",     s.handleFilesList)
	a("/api/files/mkdir",    s.handleFilesMkdir)
	a("/api/files/delete",   s.handleFilesDelete)
	a("/api/files/rename",   s.handleFilesRename)
	a("/api/files/chmod",    s.handleFilesChmod)
	a("/api/files/preview",  s.handleFilesPreview)
	a("/api/files/download", s.handleFilesDownload)
	a("/api/files/upload",   s.handleFilesUpload)
	a("/api/files/mounts",   s.handleFilesMounts)

	// ZFS pool create
	a("/api/zfs/pool/create", s.handleZFSPoolCreate)

	// Package manager
	a("/api/packages/installed",   s.handlePkgInstalled)
	a("/api/packages/search",      s.handlePkgSearch)
	a("/api/packages/show",        s.handlePkgShow)
	a("/api/packages/install",     s.handlePkgInstall)
	a("/api/packages/remove",      s.handlePkgRemove)
	a("/api/packages/mark-manual", s.handlePkgMarkManual)
	a("/api/packages/autoremove",  s.handlePkgAutoremove)
	a("/api/packages/update",      s.handlePkgUpdate)
	a("/api/packages/stats",       s.handlePkgStats)

	// service status helper
	a("/services/status/", s.handleServiceStatusHelper)

	// static — must be last
	s.mux.HandleFunc("/", s.handleStatic)
}

func (s *Server) auth_(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie("nimbus_session")
		if err != nil || !s.auth.Valid(c.Value) {
			jsonErr(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "bad request", http.StatusBadRequest); return
	}
	if req.Username == "" || req.Password == "" {
		jsonErr(w, "username and password required", http.StatusBadRequest); return
	}

	token, userInfo, err := s.auth.Login(req.Username, req.Password)
	if err != nil {
		// Celowo nie ujawniamy czy użytkownik istnieje
		jsonErr(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	// Jeśli użytkownik ma 2FA — nie twórz sesji, zwróć needs_2fa
	// token jest tymczasowy — zostanie zamieniony na sesję po weryfikacji kodu
	if totpEnabled(req.Username) {
		// Unieważnij token (usuń sesję) — nie chcemy żeby działał bez 2FA
		s.auth.Logout(token)
		// Zwróć tymczasowy identyfikator do weryfikacji TOTP
		tmpToken := totpCreatePendingSession(req.Username)
		jsonOK(w, map[string]any{
			"success":   false,
			"needs_2fa": true,
			"tmp_token": tmpToken,
		})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "nimbus_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int((24 * time.Hour).Seconds()),
	})

	jsonOK(w, map[string]any{
		"success": true,
		"user":    userInfo,
	})
}

func (s *Server) handleVerifyTOTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { jsonErr(w, "method not allowed", http.StatusMethodNotAllowed); return }
	var req struct {
		TmpToken string `json:"tmp_token"`
		Code     string `json:"code"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.TmpToken == "" || req.Code == "" {
		jsonErr(w, "tmp_token i code są wymagane", http.StatusBadRequest); return
	}

	// Sprawdź tymczasowy token
	username := totpGetPendingUser(req.TmpToken)
	if username == "" {
		jsonErr(w, "invalid or expired token", http.StatusUnauthorized); return
	}

	// Weryfikuj kod TOTP
	if !totpVerify(username, req.Code) {
		jsonErr(w, "invalid_totp", http.StatusUnauthorized); return
	}

	// Usuń tymczasowy token
	totpRemovePendingSession(req.TmpToken)

	// Utwórz prawdziwą sesję
	token, userInfo, err := s.auth.LoginDirect(username)
	if err != nil {
		jsonErr(w, "session error: "+err.Error(), http.StatusInternalServerError); return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "nimbus_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int((24 * time.Hour).Seconds()),
	})

	jsonOK(w, map[string]any{"success": true, "user": userInfo})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("nimbus_session"); err == nil {
		s.auth.Logout(c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: "nimbus_session", Value: "", Path: "/", MaxAge: -1})
	jsonOK(w, map[string]string{"status": "ok"})
}

func (s *Server) handleCheckAuth(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("nimbus_session")
	if err != nil || !s.auth.Valid(c.Value) {
		jsonErr(w, "unauthorized", http.StatusUnauthorized); return
	}
	username := s.auth.SessionUser(c.Value)
	jsonOK(w, map[string]any{
		"authenticated": true,
		"username":      username,
	})
}

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	if p == "/" { p = "/index.html" }
	clean := filepath.Clean(filepath.Join(s.cfg.WebDir, p))
	if !strings.HasPrefix(clean, filepath.Clean(s.cfg.WebDir)) {
		http.Error(w, "forbidden", http.StatusForbidden); return
	}
	info, err := os.Stat(clean)
	if err != nil || info.IsDir() {
		http.ServeFile(w, r, filepath.Join(s.cfg.WebDir, "index.html")); return
	}
	if strings.HasSuffix(clean, ".jsx") {
		w.Header().Set("Content-Type", "application/javascript")
	}
	// Cache dla statyki (bundle.js, CSS) — nie zmienia się między restartami
	if strings.HasSuffix(clean, ".js") || strings.HasSuffix(clean, ".css") {
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
	// Gzip jeśli klient obsługuje
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		if strings.HasSuffix(clean, ".js") || strings.HasSuffix(clean, ".css") {
			w.Header().Set("Content-Encoding", "gzip")
			w.Header().Set("Vary", "Accept-Encoding")
			// Sprawdź czy jest skompresowana wersja
			gzPath := clean + ".gz"
			if _, err := os.Stat(gzPath); err == nil {
				if strings.HasSuffix(clean, ".js") {
					w.Header().Set("Content-Type", "application/javascript")
				} else {
					w.Header().Set("Content-Type", "text/css")
				}
				http.ServeFile(w, r, gzPath)
				return
			}
		}
	}
	http.ServeFile(w, r, clean)
}

func (s *Server) handleServiceStatusHelper(w http.ResponseWriter, r *http.Request) {
	svc := pathSuffix(r, "/services/status/")
	jsonOK(w, map[string]any{"service": svc, "active": serviceActive(svc), "enabled": serviceEnabled(svc)})
}
