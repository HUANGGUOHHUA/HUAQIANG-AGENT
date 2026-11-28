/** Platform helpers. Keep all OS branching in one place. */
export const isWindows = process.platform === 'win32'
export const isLinux = process.platform === 'linux'
export const isMac = process.platform === 'darwin'

/** Default Python interpreter name for the current platform. */
export function pythonCommand(): string {
  return isWindows ? 'python.exe' : 'python3'
}

/** Path segment for executables inside a venv (`Scripts` on Windows, `bin` otherwise). */
export function venvBinDir(): string {
  return isWindows ? 'Scripts' : 'bin'
}

/** Name of the Python executable inside a venv. */
export function venvPythonName(): string {
  return isWindows ? 'python.exe' : 'python'
}