package sys

import (
	"syscall"
	"unsafe"
)

type syscallStatfs struct {
	Type    int64
	Bsize   int64
	Blocks  uint64
	Bfree   uint64
	Bavail  uint64
	Files   uint64
	Ffree   uint64
	Fsid    [2]int32
	Namelen int64
	Frsize  int64
	Flags   int64
	Spare   [4]int64
}

func statfs(path string, buf *syscallStatfs) error {
	var s syscall.Statfs_t
	err := syscall.Statfs(path, &s)
	if err != nil {
		return err
	}
	buf.Bsize = int64(s.Bsize)
	buf.Blocks = s.Blocks
	buf.Bfree = s.Bfree
	buf.Bavail = s.Bavail
	_ = unsafe.Sizeof(buf)
	return nil
}
