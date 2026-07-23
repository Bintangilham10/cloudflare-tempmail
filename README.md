# Cloudflare Tempmail

Aplikasi temporary email untuk Cloudflare Workers, Pages, D1, R2, dan Email Routing.
Gunakan domain khusus tempmail—jangan gunakan domain bisnis utama.

## Arsitektur production

| Komponen | Production | Staging |
|---|---|---|
| Inbox Pages | `mail.<TEMPMAIL_DOMAIN>` | `staging-mail.<TEMPMAIL_DOMAIN>` |
| Admin Pages | `admin.<TEMPMAIL_DOMAIN>` | `staging-admin.<TEMPMAIL_DOMAIN>` |
| Worker API | `api.<TEMPMAIL_DOMAIN>` | `staging-api.<TEMPMAIL_DOMAIN>` |
| D1 | `tempmail-prod` | `tempmail-staging` |
| R2 | `tempmail-messages-prod` | `tempmail-messages-staging` |

Satu Pages project per environment melayani host inbox dan admin. UI memilih tampilan berdasarkan
hostname yang diberikan saat build.

### Model data

- D1 menyimpan domain, mailbox, metadata email, body yang dibatasi, dan object key.
- R2 menyimpan raw EML dan isi attachment.
- Email hanya diterima jika mailbox sudah dibuat oleh pengguna.
- Email ke alamat yang belum ada ditolak; inbound tidak membuat mailbox otomatis.
- Cron menghapus object R2 terlebih dahulu, lalu row D1 dalam batch terbatas.

### Batas keamanan

- Raw email: 20 MiB.
- Maksimal 10 attachment.
- Maksimal 5 MiB per attachment dan 20 MiB total attachment.
- Body text dan HTML: masing-masing 256 KiB.
- Pembuatan mailbox: 5/menit/IP.
- Pembacaan inbox: 120/menit/token mailbox.
- Login/setup: 5/menit/IP ditambah lockout D1.
- Nama sensitif seperti `admin`, `support`, `security`, dan `postmaster` tidak dapat dibuat.
- Session admin menggunakan cookie `HttpOnly`, `Secure`, `SameSite=Strict`; hanya hash session yang
  masuk D1.
- Password admin menggunakan PBKDF2-SHA256 600.000 iterasi.

## Prasyarat

- Node.js 22 atau lebih baru.
- Akun Cloudflare dengan zone `<TEMPMAIL_DOMAIN>` aktif.
- Workers, Pages, D1, R2, dan Email Routing berada di akun Cloudflare yang sama.
- Wrangler dipin ke `4.112.0` melalui lockfile project.

Jalankan perintah dari PowerShell di root repository, kecuali disebut lain.

## 1. Verifikasi source lokal

```powershell
npm ci --ignore-scripts
npm audit --omit=dev --audit-level=high
npm run typecheck
npm test
```

Periksa script dependency sebelum mengizinkan lifecycle script. Setelah aman, install normal dapat
dijalankan bila suatu package memang membutuhkannya.

Build production wajib menerima empat variabel frontend dan akan gagal bila salah satunya kosong:

```powershell
$env:VITE_PUBLIC_HOST="mail.example.com"
$env:VITE_ADMIN_HOST="admin.example.com"
$env:VITE_PUBLIC_INBOX_URL="https://mail.example.com"
$env:VITE_API_BASE="https://api.example.com"
npm run build
```

Nilai `example.com` di atas hanya untuk quality gate lokal, bukan konfigurasi deployment.

## 2. Login ke akun Cloudflare

Gunakan Wrangler dari project, bukan instalasi global:

```powershell
npx wrangler@4.112.0 login
npx wrangler@4.112.0 whoami
```

Pastikan `whoami` menampilkan akun yang memiliki zone tempmail.

## 3. Buat resource staging dan production

```powershell
npx wrangler@4.112.0 d1 create tempmail-staging --location=apac
npx wrangler@4.112.0 d1 create tempmail-prod --location=apac

npx wrangler@4.112.0 r2 bucket create tempmail-messages-staging
npx wrangler@4.112.0 r2 bucket create tempmail-messages-prod
```

Catat UUID yang dikembalikan oleh kedua perintah `d1 create`. R2 menggunakan nama bucket, bukan UUID.

## 4. Render konfigurasi Worker

Ganti nilai contoh berikut dengan domain khusus tempmail dan dua UUID D1 milik akun Anda:

```powershell
npm run configure --workspace=tempmail-api -- `
  --domain <TEMPMAIL_DOMAIN> `
  --prod-db-id <PRODUCTION_D1_UUID> `
  --staging-db-id <STAGING_D1_UUID>
```

Perintah ini membuat `worker/wrangler.toml` dari
`worker/wrangler.toml.example`. Periksa hasilnya sebelum deploy:

```powershell
Get-Content worker\wrangler.toml
```

Konfigurasi tersebut memisahkan binding D1/R2/rate limiter, vars, custom domain, serta sampling
observability staging dan production. ID namespace rate limiter adalah angka yang ditentukan pengguna;
ubah bila angka yang sama sudah dipakai Worker lain di akun tersebut.

Jangan pernah menaruh `ADMIN_BOOTSTRAP_SECRET` di `[vars]` atau commit secret ke Git.

## 5. Simpan bootstrap secret

Buat secret acak yang panjangnya minimal 32 karakter. Masuk ke folder Worker:

```powershell
Set-Location worker
npx wrangler@4.112.0 secret put ADMIN_BOOTSTRAP_SECRET --env staging
npx wrangler@4.112.0 secret put ADMIN_BOOTSTRAP_SECRET
```

Wrangler meminta nilainya melalui prompt tersembunyi. Gunakan nilai berbeda untuk staging dan production.

## 6. Migrasi dan deploy Worker staging

```powershell
npx wrangler@4.112.0 d1 migrations apply tempmail-staging --remote --env staging
npm run deploy:staging
Set-Location ..
```

`deploy:staging` menjalankan guard yang menolak config tanpa D1, R2, rate limiter, origin, dan custom
domain. Jangan lanjut jika migrasi atau deploy gagal.

## 7. Buat dan deploy Pages staging

Buat Direct Upload project satu kali:

```powershell
npx wrangler@4.112.0 pages project create tempmail-web-staging --production-branch main
```

Build ulang menggunakan host staging:

```powershell
$env:VITE_PUBLIC_HOST="staging-mail.<TEMPMAIL_DOMAIN>"
$env:VITE_ADMIN_HOST="staging-admin.<TEMPMAIL_DOMAIN>"
$env:VITE_PUBLIC_INBOX_URL="https://staging-mail.<TEMPMAIL_DOMAIN>"
$env:VITE_API_BASE="https://staging-api.<TEMPMAIL_DOMAIN>"
npm run build --workspace=tempmail-frontend
npx wrangler@4.112.0 pages deploy frontend/dist --project-name tempmail-web-staging --branch main
```

Di Cloudflare Dashboard buka **Workers & Pages → tempmail-web-staging → Custom domains**, lalu pasang:

- `staging-mail.<TEMPMAIL_DOMAIN>`
- `staging-admin.<TEMPMAIL_DOMAIN>`

Lindungi host admin staging dengan Cloudflare Access dan allowlist email pemilik.

## 8. Setup dan smoke test staging

1. Buka `https://staging-admin.<TEMPMAIL_DOMAIN>`.
2. Masukkan bootstrap secret staging dan password admin 12–128 karakter.
3. Tambahkan `<TEMPMAIL_DOMAIN>` sebagai domain aktif.
4. Buka inbox staging dan buat mailbox `smoke@<TEMPMAIL_DOMAIN>`.
5. Di Email Routing buat rule literal sementara untuk `smoke@<TEMPMAIL_DOMAIN>` menuju Worker staging.
6. Kirim email nyata berisi plain text, HTML, attachment 1 MiB, dan attachment mendekati 5 MiB.
7. Verifikasi raw EML, download attachment, CSP, CORS, polling, dan rendering HTML.
8. Pastikan gambar remote/tracker tidak dimuat dan script HTML email tidak berjalan.
9. Hapus rule staging setelah pengujian selesai.

Jangan aktifkan catch-all production pada tahap ini.

## 9. Migrasi dan deploy production

Catat bookmark D1 Time Travel sebelum migrasi yang mengubah database production. Setelah itu:

```powershell
Set-Location worker
npx wrangler@4.112.0 d1 migrations apply tempmail-prod --remote
npm run deploy
Set-Location ..
```

Buat dan deploy Pages production:

```powershell
npx wrangler@4.112.0 pages project create tempmail-web-prod --production-branch main

$env:VITE_PUBLIC_HOST="mail.<TEMPMAIL_DOMAIN>"
$env:VITE_ADMIN_HOST="admin.<TEMPMAIL_DOMAIN>"
$env:VITE_PUBLIC_INBOX_URL="https://mail.<TEMPMAIL_DOMAIN>"
$env:VITE_API_BASE="https://api.<TEMPMAIL_DOMAIN>"
npm run build --workspace=tempmail-frontend
npx wrangler@4.112.0 pages deploy frontend/dist --project-name tempmail-web-prod --branch main
```

Pasang `mail.<TEMPMAIL_DOMAIN>` dan `admin.<TEMPMAIL_DOMAIN>` sebagai custom domain Pages production.
Lindungi host admin production dengan Cloudflare Access.

## 10. Go-live

1. Setup admin production memakai bootstrap secret production.
2. Tambahkan `<TEMPMAIL_DOMAIN>` sebagai domain aktif.
3. Hapus bootstrap secret setelah setup selesai:

   ```powershell
   Set-Location worker
   npx wrangler@4.112.0 secret delete ADMIN_BOOTSTRAP_SECRET
   Set-Location ..
   ```

4. Jalankan health check API, login admin, create mailbox, polling, raw EML, attachment, cron, CORS,
   security headers, dan dashboard usage.
5. Aktifkan Email Routing serta MX records pada zone.
6. Jadikan **catch-all → Worker production** sebagai langkah terakhir.
7. Buka sebagai beta terbatas sebelum trafik publik penuh.

## Kill switch dan rollback

Jika terjadi kebocoran, error inbound, lonjakan biaya, atau kegagalan storage:

1. Nonaktifkan catch-all Email Routing terlebih dahulu.
2. Rollback Worker ke version sebelumnya dan Pages ke deployment sebelumnya.
3. Pertahankan D1/R2 untuk investigasi; jangan hapus resource atau data.
4. Jika migrasi merusak data, restore D1 dari bookmark Time Travel.
5. Aktifkan routing kembali hanya setelah smoke test staging lulus.

## Quality gate akhir

```powershell
npm ci --ignore-scripts
npm audit
npm audit --omit=dev --audit-level=high
npm run typecheck
npm test

$env:VITE_PUBLIC_HOST="mail.example.com"
$env:VITE_ADMIN_HOST="admin.example.com"
$env:VITE_PUBLIC_INBOX_URL="https://mail.example.com"
$env:VITE_API_BASE="https://api.example.com"
npm run build
```

Production siap hanya jika semua perintah hijau, tidak ada domain penjual, bootstrap takeover tertutup,
attachment masuk R2, limiter menghasilkan 429, staging menerima email nyata, log tidak memuat alamat lengkap,
subject, token, body, atau attachment, dan catch-all dapat dimatikan sebagai kill switch.
