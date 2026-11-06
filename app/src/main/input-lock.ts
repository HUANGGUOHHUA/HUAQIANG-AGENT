import { spawn, type ChildProcess } from 'node:child_process'
import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Low-level mouse hook used only while the control overlay is active.
 * Physical mouse events are swallowed; events flagged LLMHF_INJECTED (the
 * agent's own SetCursorPos/mouse_event calls) pass through.
 */
const LOCK_SCRIPT = String.raw`param([int]$ParentPid, [int]$MaxMinutes = 60)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class HqInputLock
{
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSLLHOOKSTRUCT
    {
        public POINT pt;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc callback, IntPtr module, uint threadId);

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hook, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetModuleHandle(string moduleName);

    [DllImport("user32.dll")]
    static extern bool PeekMessage(out MSG message, IntPtr hwnd, uint min, uint max, uint remove);

    [DllImport("user32.dll")]
    static extern bool TranslateMessage(ref MSG message);

    [DllImport("user32.dll")]
    static extern IntPtr DispatchMessage(ref MSG message);

    const int WH_MOUSE_LL = 14;
    const uint PM_REMOVE = 1;
    const uint LLMHF_INJECTED = 0x00000001;

    static LowLevelMouseProc callback = Hook;
    static IntPtr hook = IntPtr.Zero;

    static IntPtr Hook(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            MSLLHOOKSTRUCT info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
            if ((info.flags & LLMHF_INJECTED) == 0)
            {
                // Human mouse input is blocked; the agent's injected events pass.
                return (IntPtr)1;
            }
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    public static bool Start()
    {
        hook = SetWindowsHookEx(WH_MOUSE_LL, callback, GetModuleHandle(null), 0);
        return hook != IntPtr.Zero;
    }

    public static void Stop()
    {
        if (hook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(hook);
            hook = IntPtr.Zero;
        }
    }

    public static void Run(int parentPid, int maxMinutes)
    {
        if (!Start()) throw new InvalidOperationException("SetWindowsHookEx(WH_MOUSE_LL) failed");
        Console.WriteLine("LOCKED");
        Console.Out.Flush();
        DateTime deadline = DateTime.UtcNow.AddMinutes(Math.Max(1, maxMinutes));
        while (DateTime.UtcNow < deadline)
        {
            bool parentGone = false;
            try { parentGone = Process.GetProcessById(parentPid).HasExited; }
            catch { parentGone = true; }
            if (parentGone) break;

            MSG message;
            while (PeekMessage(out message, IntPtr.Zero, 0, 0, PM_REMOVE))
            {
                TranslateMessage(ref message);
                DispatchMessage(ref message);
            }
            Thread.Sleep(40);
        }
        Stop();
    }
}
'@
try {
  [HqInputLock]::Run($ParentPid, $MaxMinutes)
} finally {
  [HqInputLock]::Stop()
}
`

let child: ChildProcess | null = null
let scriptPath: string | null = null

export function startInputLock(parentPid: number): void {
  if (child && child.exitCode === null) return
  try {
    const path = join(tmpdir(), `huaqiang-input-lock-${process.pid}.ps1`)
    writeFileSync(path, LOCK_SCRIPT, 'utf8')
    scriptPath = path
    const processHandle = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path,
        '-ParentPid',
        String(parentPid),
        '-MaxMinutes',
        '60'
      ],
      { windowsHide: true, stdio: 'ignore', detached: false }
    )
    child = processHandle
    processHandle.once('exit', () => {
      if (child === processHandle) child = null
      if (scriptPath) {
        try {
          unlinkSync(scriptPath)
        } catch {
          // The script may still be in use; it is harmless in %TEMP%.
        }
        scriptPath = null
      }
    })
    processHandle.once('error', () => {
      if (child === processHandle) child = null
    })
  } catch {
    child = null
  }
}

export function stopInputLock(): void {
  const processHandle = child
  child = null
  if (processHandle && processHandle.pid && processHandle.exitCode === null) {
    try {
      processHandle.kill()
    } catch {
      // Process may already be gone.
    }
    try {
      spawn('taskkill', ['/PID', String(processHandle.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      }).unref()
    } catch {
      // Process may already be gone.
    }
  }
  if (scriptPath) {
    try {
      unlinkSync(scriptPath)
    } catch {
      // Harmless if the script is still briefly open.
    }
    scriptPath = null
  }
}

export function isInputLockActive(): boolean {
  return Boolean(child && child.exitCode === null)
}
