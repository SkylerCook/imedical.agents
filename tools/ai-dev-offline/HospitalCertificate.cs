using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace AiDevOffline {
    static class HospitalCertificate {
        const int CertificateContext = 2;

        [DllImport("crypt32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool CryptVerifyCertificateSignatureEx(IntPtr provider, uint encoding,
            uint subjectType, IntPtr subject, uint issuerType, IntPtr issuer, uint flags, IntPtr extra);

        internal static X509Certificate2 ReadPublicCertificate(string path) {
            byte[] bytes = File.ReadAllBytes(path);
            string pem = Encoding.UTF8.GetString(bytes).TrimStart('\uFEFF').Trim();
            Match block = Regex.Match(pem, @"\A-----BEGIN CERTIFICATE-----\s+([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----\z");
            if (block.Success) bytes = Convert.FromBase64String(block.Groups[1].Value);
            if (X509Certificate2.GetCertContentType(bytes) != X509ContentType.Cert)
                throw new CryptographicException("请选择单张公开证书（CER、CRT 或 PEM）。");

            var certificate = new X509Certificate2(bytes);
            if (bytes.SequenceEqual(certificate.RawData) &&
                certificate.SubjectName.RawData.SequenceEqual(certificate.IssuerName.RawData) &&
                CryptVerifyCertificateSignatureEx(IntPtr.Zero, 1, CertificateContext, certificate.Handle,
                    CertificateContext, certificate.Handle, 0, IntPtr.Zero)) return certificate;
            certificate.Dispose();
            throw new CryptographicException("请选择医院提供的根 CA 证书或自签名服务器证书。");
        }

        internal static string Fingerprint(X509Certificate2 certificate) {
            using (var sha256 = SHA256.Create()) {
                return BitConverter.ToString(sha256.ComputeHash(certificate.RawData)).Replace("-", "");
            }
        }

        internal static bool Contains(X509Store store, X509Certificate2 certificate) {
            var matches = store.Certificates.Find(X509FindType.FindByThumbprint, certificate.Thumbprint, false);
            bool present = false;
            foreach (X509Certificate2 candidate in matches) {
                using (candidate) {
                    present |= candidate.RawData.SequenceEqual(certificate.RawData);
                }
            }
            return present;
        }

        static bool IsCurrent(X509Certificate2 certificate) {
            DateTime now = DateTime.Now;
            return certificate.NotBefore <= now && now <= certificate.NotAfter;
        }

        internal static bool Import(X509Store store, X509Certificate2 certificate) {
            if (!IsCurrent(certificate)) throw new InvalidOperationException("证书已过期或尚未生效。");
            if (Contains(store, certificate)) return false;
            store.Add(certificate);
            if (!Contains(store, certificate)) throw new InvalidOperationException("无法在信任库中读回证书。");
            return true;
        }

        internal static void Show(IWin32Window owner) {
            const string title = "医院 HTTPS 证书";
            using (var picker = new OpenFileDialog {
                Title = "选择医院提供的公开证书",
                Filter = "公开证书 (*.cer;*.crt;*.pem)|*.cer;*.crt;*.pem",
                CheckFileExists = true,
                RestoreDirectory = true
            }) {
                if (picker.ShowDialog(owner) != DialogResult.OK) return;
                try {
                    using (var certificate = ReadPublicCertificate(picker.FileName))
                    using (var store = new X509Store(StoreName.Root, StoreLocation.CurrentUser)) {
                        store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
                        bool present = Contains(store, certificate);
                        store.Close();
                        var san = certificate.Extensions["2.5.29.17"];
                        string details = "主题：" + certificate.Subject + "\n颁发者：" + certificate.Issuer +
                            (san == null ? "" : "\n服务器名称：" + san.Format(false)) +
                            "\n有效期：" + certificate.NotBefore.ToString("yyyy-MM-dd HH:mm") + " 至 " +
                            certificate.NotAfter.ToString("yyyy-MM-dd HH:mm") +
                            "\nSHA-256 指纹：\n" + Fingerprint(certificate) +
                            "\n\n信任范围：当前 Windows 用户的受信任根证书库";
                        if (!IsCurrent(certificate)) {
                            MessageBox.Show(owner, details + "\n\n证书已过期或尚未生效。", title,
                                MessageBoxButtons.OK, MessageBoxIcon.Warning);
                            return;
                        }
                        if (present) {
                            MessageBox.Show(owner, details + "\n\n已信任此证书，可以直接连接。", title,
                                MessageBoxButtons.OK, MessageBoxIcon.Information);
                            return;
                        }
                        if (MessageBox.Show(owner, details + "\n\n请与医院管理员核对指纹。确认将此证书添加到信任库吗？",
                            title, MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                            MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;

                        store.Open(OpenFlags.ReadWrite | OpenFlags.OpenExistingOnly);
                        bool added = Import(store, certificate);
                        MessageBox.Show(owner, (added ? "证书已导入并核验。" : "已信任此证书。") +
                            "请重启 VS Code 后验证 IRIS 连接。", title, MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }
                } catch (Exception error) {
                    MessageBox.Show(owner, "证书处理失败。请检查证书文件及当前用户的证书库权限。\n\n" +
                        error.Message, title, MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
        }
    }
}
