$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WorkbenchFolderPicker
{
    [Flags]
    private enum DialogOptions : uint
    {
        NoChangeDirectory = 0x00000008,
        PickFolders = 0x00000020,
        ForceFileSystem = 0x00000040,
        PathMustExist = 0x00000800
    }

    // Keep the native method order for the IFileDialog and IShellItem vtables.
    [ComImport]
    [Guid("42F85136-DB7E-439C-85F1-E4075D135FC8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr filters);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(DialogOptions options);
        void GetOptions(out DialogOptions options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName(out IntPtr name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
        void AddPlace(IShellItem item, int placement);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        void Close(int result);
        void SetClientGuid(ref Guid client);
    }

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid type, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint nameType, out IntPtr name);
    }

    public static string Select(string title)
    {
        var fileOpenDialog = new Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7");
        var dialog = (IFileDialog)Activator.CreateInstance(Type.GetTypeFromCLSID(fileOpenDialog));
        try
        {
            // Give the launcher its own location history across Workbench releases.
            var workbenchClient = new Guid("8B385216-B47A-4F5A-B2F9-B71B1D655C32");
            dialog.SetClientGuid(ref workbenchClient);
            DialogOptions options;
            dialog.GetOptions(out options);
            dialog.SetOptions(options | DialogOptions.PickFolders | DialogOptions.ForceFileSystem | DialogOptions.PathMustExist | DialogOptions.NoChangeDirectory);
            dialog.SetTitle(title);

            const int cancelled = unchecked((int)0x800704C7); // HRESULT_FROM_WIN32(ERROR_CANCELLED)
            int result = dialog.Show(IntPtr.Zero);
            if (result == cancelled) return null;
            Marshal.ThrowExceptionForHR(result);

            IShellItem folder;
            dialog.GetResult(out folder);
            IntPtr name = IntPtr.Zero;
            try
            {
                const uint fileSystemPath = 0x80058000; // SIGDN_FILESYSPATH
                folder.GetDisplayName(fileSystemPath, out name);
                return Marshal.PtrToStringUni(name);
            }
            finally
            {
                Marshal.FreeCoTaskMem(name);
                Marshal.ReleaseComObject(folder);
            }
        }
        finally
        {
            Marshal.ReleaseComObject(dialog);
        }
    }
}
'@

$projectRoot = [WorkbenchFolderPicker]::Select('选择工程文件夹')
if (-not $projectRoot) { exit 0 }

$node = Join-Path $PSScriptRoot 'runtime\node.exe'
$entry = Join-Path $PSScriptRoot 'tools\agents-workbench\src\start-release.js'
& $node $entry --background --open --project $projectRoot
exit $LASTEXITCODE
