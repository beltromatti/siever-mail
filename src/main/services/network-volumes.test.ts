import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const {
  canonicalMountPoint,
  isSameShare,
  movedPath,
  parseDriveMappings,
  parseNetworkMounts,
  volumeMountPointOf
} = await import('./network-volumes')

describe('parseNetworkMounts', () => {
  it('reads the shares mounted, each as the URL it came from', () => {
    const output = [
      '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
      'devfs on /dev (devfs, local, nobrowse)',
      '//anna@nas.local/Lavori on /Volumes/Lavori (smbfs, nodev, nosuid, mounted by anna)',
      '//SIEVER;anna@192.168.1.10/Ufficio%20Tecnico on /Volumes/Ufficio Tecnico (smbfs, nodev, nosuid, mounted by anna)',
      'nas.local:/export/archivio on /Volumes/archivio (nfs, nodev, nosuid, mounted by anna)',
      'https://dav.example.it/files on /Volumes/files (webdav, nodev, noexec, nosuid, mounted by anna)',
      '/dev/disk4s1 on /Volumes/SIEVER Mail 1.9.0-arm64 (hfs, local, nodev, nosuid, read-only)',
      'map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)'
    ].join('\n')

    expect(parseNetworkMounts(output)).toEqual([
      { mountPoint: '/Volumes/Lavori', url: 'smb://anna@nas.local/Lavori' },
      {
        mountPoint: '/Volumes/Ufficio Tecnico',
        url: 'smb://SIEVER;anna@192.168.1.10/Ufficio%20Tecnico'
      },
      { mountPoint: '/Volumes/archivio', url: 'nfs://nas.local/export/archivio' },
      { mountPoint: '/Volumes/files', url: 'https://dav.example.it/files' }
    ])
  })
})

describe('volumeMountPointOf', () => {
  it('finds the volume a path is on', () => {
    expect(volumeMountPointOf('/Volumes/Lavori/Prat619-IKEA/Verbali')).toBe('/Volumes/Lavori')
    expect(volumeMountPointOf('/Volumes/Ufficio Tecnico')).toBe('/Volumes/Ufficio Tecnico')
    expect(volumeMountPointOf('/Volumes/Lavori/../Archivio/x')).toBe('/Volumes/Archivio')
  })

  it('leaves out paths on the startup disk', () => {
    expect(volumeMountPointOf('/Users/anna/Documents')).toBeNull()
    expect(volumeMountPointOf('/Volumes')).toBeNull()
    expect(volumeMountPointOf('/VolumesX/a')).toBeNull()
  })
})

describe('a share mounted elsewhere', () => {
  it('reaches a kept path under the mount point the share has now', () => {
    expect(
      movedPath('/Volumes/Archivio/Pratiche/Prat2451', '/Volumes/Archivio', '/Volumes/Archivio-1')
    ).toBe('/Volumes/Archivio-1/Pratiche/Prat2451')
    expect(movedPath('Z:\\Pratiche\\Prat2451', 'Z:', 'Y:')).toBe('Y:\\Pratiche\\Prat2451')
    expect(movedPath('Z:\\Pratiche', 'Z:', '\\\\nas\\archivio')).toBe('\\\\nas\\archivio\\Pratiche')
  })

  it('keeps paths under the mount point the share usually has', () => {
    expect(canonicalMountPoint(['/Volumes/Archivio-1', '/Volumes/Archivio'])).toBe(
      '/Volumes/Archivio'
    )
    expect(canonicalMountPoint(['/Volumes/Archivio-1'])).toBe('/Volumes/Archivio-1')
    expect(canonicalMountPoint([])).toBeUndefined()
  })

  it('knows one share by its server and name, whoever mounted it', () => {
    expect(isSameShare('smb://anna@nas.local/Archivio', 'smb://NAS.local/archivio')).toBe(true)
    expect(isSameShare('smb://nas.local/Archivio', 'smb://nas.local/Archivio2')).toBe(false)
  })

  it('reads the drives Windows maps, one or many', () => {
    expect(
      parseDriveMappings('{"LocalPath":"z:","RemotePath":"\\\\\\\\nas\\\\archivio","Status":"OK"}')
    ).toEqual([{ letter: 'Z:', remote: '\\\\nas\\archivio', status: 'OK' }])
    expect(
      parseDriveMappings(
        '[{"LocalPath":"Y:","RemotePath":"\\\\\\\\nas\\\\x","Status":"Unavailable"},{"LocalPath":"","RemotePath":"\\\\\\\\nas\\\\ipc$","Status":"OK"}]'
      )
    ).toEqual([{ letter: 'Y:', remote: '\\\\nas\\x', status: 'Unavailable' }])
    expect(parseDriveMappings('')).toEqual([])
  })
})
