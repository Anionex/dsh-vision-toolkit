import { execFile } from 'node:child_process'
import { basename, dirname, win32 } from 'node:path'
import { promisify } from 'node:util'
import { VisionToolkitError } from './errors.ts'

const ROOT_NAME = 'DSH-Vision-Toolkit-Fallback'
const WORKSPACE_NAME = /^[a-f0-9]{20}$/
const execFileAsync = promisify(execFile)

// Windows PowerShell 5.1 ships with Windows and exposes the .NET Framework
// ACL APIs without a native addon. Use the Windows known folder API, not a
// user-supplied storage path or an inherited LOCALAPPDATA value.
const VERIFY_PRIVATE_STORAGE = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$workspaceId = $env:DSH_VISION_FALLBACK_WORKSPACE
if ($workspaceId -cnotmatch '^[a-f0-9]{20}$') { throw 'Invalid fallback workspace.' }
$create = $env:DSH_VISION_FALLBACK_CREATE -eq '1'
$requestedEntry = $env:DSH_VISION_FALLBACK_ENTRY
$checkDirectory = $env:DSH_VISION_FALLBACK_DIRECTORY -eq '1'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$user = $identity.User
$userSid = $user.Value
$system = 'S-1-5-18'
$administrators = 'S-1-5-32-544'
$trustedInstaller = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$trusted = @($userSid, $system, $administrators, $trustedInstaller)
$sections = [Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner

function Assert-SafeItem($path, $private, $directory, $protectedAcl = $false) {
  $attributes = [IO.File]::GetAttributes($path)
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Fallback storage cannot traverse a Windows reparse point.'
  }
  if ((($attributes -band [IO.FileAttributes]::Directory) -ne 0) -ne $directory) {
    throw 'Fallback storage encountered an unexpected entry type.'
  }
  if ($directory) { $security = [IO.Directory]::GetAccessControl($path, $sections) }
  else { $security = [IO.File]::GetAccessControl($path, $sections) }
  $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($security.GetSecurityDescriptorBinaryForm(), 0)
  if ($null -eq $descriptor.Owner -or $trusted -notcontains $descriptor.Owner.Value -or $null -eq $descriptor.DiscretionaryAcl) {
    throw 'Fallback storage must have a trusted owner and a Windows ACL.'
  }
  if ($protectedAcl -and -not $security.AreAccessRulesProtected) {
    throw 'The private fallback base must not inherit permissions from its parent.'
  }
  foreach ($ace in $descriptor.DiscretionaryAcl) {
    if (-not $private -and ($ace.AceFlags -band [Security.AccessControl.AceFlags]::InheritOnly) -ne 0) { continue }
    if ($ace.AceType -eq [Security.AccessControl.AceType]::AccessDenied) { continue }
    if ($ace.AceType -ne [Security.AccessControl.AceType]::AccessAllowed) {
      throw 'Fallback storage encountered an unsupported Windows ACL entry.'
    }
    if ($trusted -contains $ace.SecurityIdentifier.Value) { continue }
    # Untrusted ancestor users may traverse directories or create unrelated
    # names. They may not remove/replace entries, change owner/ACL/attributes,
    # or receive generic-write/all rights. In private storage, allow no access.
    if ($private -or ($ace.AccessMask -band 0x520D0150) -ne 0) {
      throw 'Fallback storage grants access or path replacement rights to another principal.'
    }
  }
}

$appData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ($appData -notmatch '^[a-zA-Z]:\\') { throw 'Local AppData is not a local drive path.' }
$appData = [IO.Path]::GetFullPath($appData)
$volume = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($appData))
if ($volume.DriveType -ne [IO.DriveType]::Fixed -or $volume.DriveFormat -ne 'NTFS') {
  throw 'Fallback storage requires a local fixed NTFS volume.'
}

$ancestors = [Collections.Generic.Stack[string]]::new()
for ($entry = [IO.DirectoryInfo]::new($appData); $null -ne $entry; $entry = $entry.Parent) {
  $ancestors.Push($entry.FullName)
}
foreach ($ancestor in $ancestors) { Assert-SafeItem $ancestor $false $true }

$base = [IO.Path]::Combine($appData, '${ROOT_NAME}')
$bucket = [IO.Path]::Combine($base, $workspaceId)
$root = [IO.Path]::Combine($bucket, '.dsh-vision-toolkit')
foreach ($path in @($base, $bucket, $root)) {
  if (-not [IO.Directory]::Exists($path)) {
    if (-not $create) { return }
    if ($path -eq $base) {
      # Set the protected ACL as part of directory creation. Never rewrite
      # permissions on an existing directory that failed verification.
      $acl = [Security.AccessControl.DirectorySecurity]::new()
      $acl.SetAccessRuleProtection($true, $false)
      $acl.SetOwner($user)
      $inherit = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
      foreach ($principal in @($userSid, $system, $administrators)) {
        $sid = [Security.Principal.SecurityIdentifier]::new($principal)
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', $inherit, 'None', 'Allow')
        $acl.AddAccessRule($rule)
      }
      [void][IO.Directory]::CreateDirectory($path, $acl)
    } else {
      [void][IO.Directory]::CreateDirectory($path)
    }
  }
  Assert-SafeItem $path $true $true ($path -eq $base)
}

if ($requestedEntry) {
  $target = [IO.Path]::GetFullPath($requestedEntry)
  $prefix = $root + '\'
  if (-not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Entry is outside the private fallback root.' }
  $parts = $target.Substring($prefix.Length).Split('\')
  $entryPath = $root
  for ($index = 0; $index -lt $parts.Length; $index++) {
    if ($parts[$index] -notmatch '^[^:]+$') { throw 'Invalid fallback entry path.' }
    $entryPath = [IO.Path]::Combine($entryPath, $parts[$index])
    Assert-SafeItem $entryPath $true ($checkDirectory -or $index -lt ($parts.Length - 1))
  }
} else {
  # Check the persistent subdirectories the runtime may reuse. Any newly
  # created descendants inherit permissions from the protected base.
  foreach ($relative in @('artifacts', 'tmp', 'tmp\compressed-images', 'tmp\pasted-images')) {
    $entryPath = [IO.Path]::Combine($root, $relative)
    if ([IO.Directory]::Exists($entryPath)) { Assert-SafeItem $entryPath $true $true }
  }
}
[Console]::WriteLine($root)
`

const ENCODED_COMMAND = Buffer.from(VERIFY_PRIVATE_STORAGE, 'utf16le').toString('base64')

/** Recognize the reserved workspace layout for path-level revalidation. */
export function isWindowsFallbackStorageRoot(root: string): boolean {
  return process.platform === 'win32'
    && basename(root).toLowerCase() === '.dsh-vision-toolkit'
    && WORKSPACE_NAME.test(basename(dirname(root)).toLowerCase())
    && basename(dirname(dirname(root))).toLowerCase() === ROOT_NAME.toLowerCase()
}

async function verifyStorage(
  workspaceId: string,
  create: boolean,
  entry?: { path: string; directory: boolean },
): Promise<string | undefined> {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT
  if (
    process.platform !== 'win32'
    || !WORKSPACE_NAME.test(workspaceId)
    || systemRoot === undefined
    || !/^[a-z]:\\/i.test(systemRoot)
  ) {
    throw new VisionToolkitError('path', 'Windows fallback storage could not be verified')
  }
  const shellDir = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
  try {
    const { stdout } = await execFileAsync(win32.join(shellDir, 'powershell.exe'), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_COMMAND,
    ], {
      env: {
        ...process.env,
        PSModulePath: win32.join(shellDir, 'Modules'),
        DSH_VISION_FALLBACK_WORKSPACE: workspaceId,
        DSH_VISION_FALLBACK_CREATE: create ? '1' : '0',
        DSH_VISION_FALLBACK_ENTRY: entry?.path ?? '',
        DSH_VISION_FALLBACK_DIRECTORY: entry?.directory === true ? '1' : '0',
      },
      timeout: 10_000,
      windowsHide: true,
    })
    const root = stdout.trim()
    if (root === '' && !create) return undefined
    if (!win32.isAbsolute(root) || !isWindowsFallbackStorageRoot(root) || basename(dirname(root)).toLowerCase() !== workspaceId) {
      throw new Error('Windows ACL check did not return the expected private path')
    }
    return root
  } catch (cause) {
    throw new VisionToolkitError('path', 'Could not verify private Windows fallback storage. Choose a writable session workspace and retry.', { cause })
  }
}

/** Resolve the private per-workspace root, or only look it up for historical inputs. */
export function findWindowsFallbackStorage(workspaceId: string, create: boolean): Promise<string | undefined> {
  return verifyStorage(workspaceId, create)
}

async function assertEntry(root: string, path: string, directory: boolean): Promise<void> {
  const verified = await verifyStorage(basename(dirname(root)).toLowerCase(), false, { path, directory })
  if (verified === undefined || win32.relative(verified, root) !== '') {
    throw new VisionToolkitError('path', 'Entry is outside verified Windows fallback storage')
  }
}

/** Revalidate already written fallback files before allowing tool or browser access. */
export function assertWindowsFallbackFile(root: string, file: string): Promise<void> {
  return assertEntry(root, file, false)
}

/** Revalidate a reused directory below the Windows fallback root before use. */
export function assertWindowsFallbackDirectory(root: string, directory: string): Promise<void> {
  return assertEntry(root, directory, true)
}
