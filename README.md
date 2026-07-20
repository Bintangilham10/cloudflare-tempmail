# Tempmail — Cloudflare Production Guide


# PENTING GANTI yourdomain.com DENGAN DOMAINMU dan bagian Subdomain name? perhatikan dengan teliti step stepnya 
Aplikasi **temporary email** production-ready di Cloudflare:

| Layer | Service | Fungsi |
|--------|---------|--------|
| API + inbound email + cron TTL | **Cloudflare Workers** | REST API, terima email, hapus data kadaluarsa |
| UI Inbox + Admin | **Cloudflare Pages** | React + Tailwind SPA |
| Database | **Cloudflare D1** | Domain, mailbox, email, settings admin |
| Penerimaan email | **Email Routing** | Catch-all → Worker |

Versi ini fokusus **production**. Tidak ada panduan localhost.

---

## Hasil akhir yang diharapkan

| URL | Isi |
|-----|-----|
| `https://tempmail.yourdomain.com` | Inbox publik (tanpa tombol Admin) |
| `https://admin.yourdomain.com` | Panel admin saja + tombol **Buka Tempmail** |
| `https://tempmail-api.sesuaikan.workers.dev` | API Worker |
| `xxx@yourdomain.com` | Alamat email sementara |

> Ganti `yourdomain.com` / subdomain workers.dev dengan domain & akun Anda jika berbeda.

---

## Fitur

- Custom domain dinamis lewat Admin (CRUD) — **tanpa redeploy** kode
- Buat alamat **Random** / **Custom**
- Auto-create mailbox saat email masuk ke domain aktif
- Polling inbox ~12 detik
- Baca HTML (DOMPurify + iframe sandbox), plain text, unduh **EML**
- Lampiran (base64 di D1) + unduh
- Dark / Light mode
- Bahasa **Indonesia / English**
- Admin terpisah host
- Anti brute-force login: 5 gagal / IP / 15 menit → lock 30 menit + delay
- Cron TTL (default 24 jam, bisa diubah di admin)
- Tombol **Buka Tempmail** di panel admin

---

## Prasyarat

1. Akun [Cloudflare](https://dash.cloudflare.com) (domain sudah di-CF nameserver)
2. Domain contoh: **`yourdomain.com`** (zone aktif)
3. Komputer dengan:
   - **Node.js 20+** (`node -v`)
   - **npm**
4. Login Wrangler ke akun Cloudflare yang sama dengan zone domain

```bash
npm install -g wrangler
npx wrangler login
```

Browser akan minta otorisasi Cloudflare. Selesai jika `wrangler whoami` menampilkan akun Anda.

---

## Struktur project

```text
tempmail/
├── README.md                 ← panduan ini
├── schema.sql                ← skema D1
├── package.json
├── .gitignore
├── worker/                   ← API Worker
│   ├── package.json
│   ├── wrangler.toml         ← D1 + cron + CORS vars
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts          ← fetch + email + scheduled
│       ├── types.ts
│       ├── db/queries.ts
│       ├── handlers/
│       │   ├── api.ts        ← public mailbox API
│       │   ├── admin.ts      ← admin + rate limit
│       │   ├── inbound.ts    ← Email Routing handler
│       │   └── cron.ts       ← TTL cleanup
│       └── utils/
│           ├── auth.ts
│           ├── cors.ts
│           ├── parse-email.ts
│           ├── rate-limit.ts
│           └── response.ts
└── frontend/                 ← Pages SPA
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    ├── .env.example
    ├── public/_redirects
    └── src/
        ├── App.tsx           ← host-based admin vs inbox
        ├── main.tsx
        ├── index.css
        ├── lib/              ← api, i18n, hosts, sanitize, storage
        ├── hooks/
        ├── components/
        └── pages/            ← Home + Admin
```

---

## Arsitektur singkat

```text
[Browser]
   │
   ├─ https://tempmail.yourdomain.com  ──► Cloudflare Pages (Inbox UI)
   │         │
   │         └─ fetch API ──► https://tempmail-api.xxx.workers.dev
   │
   └─ https://admin.yourdomain.com     ──► Cloudflare Pages (Admin UI)
             │
             └─ fetch /api/admin/* ──► Worker (origin dicek)

[Internet email]
   └─ MX yourdomain.com (Email Routing)
         └─ Catch-all ──► Worker email() ──► parse MIME ──► D1
```

**Penting:**  
- Domain UI (`tempmail.*` / `admin.*`) → **Pages**  
- Domain API → **Worker** (`*.workers.dev` atau route terpisah)  
- Jangan pasang `tempmail.yourdomain.com` ke Worker (akan tampil JSON API, bukan UI)

---

# LANGKAH DEPLOY (ikuti berurutan)

## Langkah 0 — Siapkan source

1. Extract zip project ini.
2. Buka terminal di folder `tempmail/`.
3. Pastikan sudah `npx wrangler login`.

---

## Langkah 1 — Buat database D1

```bash
cd worker
npm install
npx wrangler d1 create tempmail
```

Contoh output:

```text
[[d1_databases]]
binding = "DB"
database_name = "tempmail"
database_id = "def7a0f9-37e7-4c6e-bead-372f3db7ce38"
```

**Salin `database_id`.**

---

## Langkah 2 — Edit `worker/wrangler.toml`

Buka `worker/wrangler.toml`, isi minimal seperti ini (sesuaikan domain & ID):

```toml
name = "tempmail-api"
main = "src/index.ts"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

workers_dev = true

[[d1_databases]]
binding = "DB"
database_name = "tempmail"
database_id = "TEMPLEKAN-ID-D1-ANDA-DI-SINI"

[triggers]
crons = ["0 * * * *"]

[vars]
ALLOWED_ORIGINS = "https://tempmail.yourdomain.com"
ALLOWED_ADMIN_ORIGINS = "https://admin.yourdomain.com"
```

### Catatan vars

| Var | Isi |
|-----|-----|
| `ALLOWED_ORIGINS` | Origin UI inbox (CORS API publik) |
| `ALLOWED_ADMIN_ORIGINS` | Origin UI admin (login/setup) |
| `ADMIN_BOOTSTRAP_SECRET` | Opsional; jika di-set, setup awal wajib secret ini |

**Jangan** sertakan `localhost` di production.

Saat pertama setup Wrangler, jika ditanya:

- **Register workers.dev subdomain?** → pilih **Y**
- **Subdomain name?** → contoh: `sesuaikan`  sesuaikan aja terserah lu
  Hasil API: `https://tempmail-api.sesuaikan.workers.dev`

---

## Langkah 3 — Migrasi skema D1 (production)

Masih di folder `worker/`:

```bash
npx wrangler d1 execute tempmail --remote --file=../schema.sql
```

Pastikan tidak ada error SQL. Perintah ini membuat tabel:

- `admin_settings`
- `domains`
- `mailboxes`
- `emails`

---

## Langkah 4 — Deploy Worker (API)

```bash
npx wrangler deploy
```

Contoh sukses:

```text
Published tempmail-api
  https://tempmail-api.sesuaikan.workers.dev
  schedule: 0 * * * *
```

### Verifikasi API

Buka browser:

```text
https://tempmail-api.sesuaikan.workers.dev/api/health
```

Harus JSON mirip:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "time": "..."
  }
}
```

Juga cek root:

```text
https://tempmail-api.sesuaikan.workers.dev/
```

→ info `tempmail-api` version.

**Catat URL Worker ini** — dipakai di frontend `VITE_API_BASE`.

---

## Langkah 5 — Build & deploy Frontend (Pages)

```bash
cd ../frontend
npm install
```

### 5.1 Buat `.env.production`

**Windows PowerShell:**

```powershell
Set-Content -Path .env.production -Value "VITE_API_BASE=https://tempmail-api.sesuaikan.workers.dev"
```

**Windows CMD:**

```cmd
echo VITE_API_BASE=https://tempmail-api.sesuaikan.workers.dev> .env.production
```

**macOS / Linux:**

```bash
echo "VITE_API_BASE=https://tempmail-api.sesuaikan.workers.dev" > .env.production
```

Ganti URL dengan Worker Anda. **Tanpa** `/` di akhir.

Cek isi file:

```powershell
Get-Content .env.production
```

### 5.2 Build

```bash
npm run build
```

Sukses jika muncul folder `frontend/dist/` dan tidak ada error TypeScript.

Jika error `TrustedHTML` / `replace` di `sanitize.ts`, pastikan barisnya:

```ts
const clean = String(DOMPurify.sanitize(dirty, PURIFY_CONFIG as any));
```

### 5.3 Deploy ke Pages

```bash
npx wrangler pages deploy dist --project-name=tempmail
```

- Jika project belum ada → pilih **Create a new project**
- Production branch: `production` (default OK)

Contoh output:

```text
Deployment complete! https://xxxx.tempmail-xxxx.pages.dev
```

URL `*.pages.dev` adalah fallback. Production utama nanti lewat custom domain.

> **Penting:** `VITE_API_BASE` di-bake saat **build**.  
> Ubah env → harus `npm run build` + deploy Pages lagi.

---

## Langkah 6 — Custom domain Pages

Dashboard Cloudflare → **Workers & Pages** → project **`tempmail`** (tipe **Pages**) → **Custom domains**.

Tambahkan **dua** domain:

1. `tempmail.yourdomain.com` → Inbox  
2. `admin.yourdomain.com` → Admin  

Status harus **Active**.

### DNS (otomatis / manual)

Di zone **yourdomain.com** → **DNS**:

| Type | Name | Target | Proxy |
|------|------|--------|--------|
| CNAME | `tempmail` | `<project>.pages.dev` (target dari CF) | Proxied 🟠 |
| CNAME | `admin` | `<project>.pages.dev` (sama) | Proxied 🟠 |

Biasanya CF mengisi otomatis saat Add Custom Domain.

### Jangan salah pasang ke Worker

Buka **Workers & Pages** → **`tempmail-api`** → **Settings** → **Domains & Routes**.

- **Hapus** `tempmail.yourdomain.com` / `admin.yourdomain.com` jika terpasang di Worker.  
- Worker cukup `*.workers.dev`.

Kalau UI domain mengarah ke Worker, yang muncul JSON:

```json
{ "success": true, "data": { "name": "tempmail-api", ... } }
```

Itu salah binding — pindahkan domain ke **Pages**.

---

## Langkah 7 — CORS final (jika perlu penyesuaian)

Setelah custom domain Active, pastikan `worker/wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGINS = "https://tempmail.yourdomain.com"
ALLOWED_ADMIN_ORIGINS = "https://admin.yourdomain.com"
```

Redeploy Worker:

```bash
cd worker
npx wrangler deploy
```

Tidak perlu rebuild frontend hanya karena ubah vars Worker.

---

## Langkah 8 — Email Routing (wajib agar email masuk)

1. Dashboard → pilih zone **`yourdomain.com`**
2. **Email** → **Email Routing**
3. **Get started / Enable** Email Routing  
   - Ikuti wizard MX records (biarkan CF yang set)
4. Tunggu status routing **Enabled**
5. Tab **Routing rules** (atau **Destination addresses** dulu jika diminta verifikasi — untuk catch-all ke Worker biasanya langsung ke rules)
6. **Catch-all address** / rule catch-all:
   - Action: **Send to a Worker**
   - Worker: **`tempmail-api`**
7. **Save**

### Catatan multi-domain

Setiap domain penerima mail (mis. `yourdomain.com` dan domain lain):

1. Zone domain itu enable Email Routing + catch-all → Worker yang sama  
2. Domain dicatat di **Admin Panel** aplikasi  

Tanpa Email Routing, API & UI jalan, tetapi email dari Gmail/dll **tidak pernah masuk**.

---

## Langkah 9 — Setup Admin production

1. Buka: **https://admin.yourdomain.com**
2. Form **Initial setup** (pertama kali):
   - Password admin (min 8 karakter) — simpan aman
   - Opsional: site name, TTL jam
   - Bootstrap secret hanya jika Anda set `ADMIN_BOOTSTRAP_SECRET` di Worker
3. Setelah masuk dashboard:
   - **Domains** → **Add** → `yourdomain.com`
   - Pastikan status **Active**
4. Tombol **Buka Tempmail** mengarah ke `https://tempmail.yourdomain.com`

### Jika login bilang invalid padahal baru setup

Biasanya hash lama korup / setup setengah jalan. Reset:

```bash
cd worker
npx wrangler d1 execute tempmail --remote --command "DELETE FROM admin_settings WHERE key IN ('admin_password_hash','setup_completed','admin_sessions')"
npx wrangler deploy
```

Lalu buka lagi `https://admin.yourdomain.com` → setup ulang.

Cek status:

```text
https://tempmail-api.sesuaikan.workers.dev/api/admin/status
```

`setup_completed` harus `false` sebelum setup ulang, `true` sesudahnya.

---

## Langkah 10 — Tes end-to-end

### A. Inbox publik

1. Buka https://tempmail.yourdomain.com  
2. Pastikan **tidak** ada tombol Admin  
3. Alamat random muncul otomatis (jika domain aktif)  
4. Atau buat **Custom** username + domain  
5. **Copy** alamat  

### B. Kirim email sungguhan

1. Dari Gmail/Outlook kirim ke alamat tempmail Anda  
2. Subject & body bebas; coba juga lampiran kecil  
3. Di inbox: **Refresh** atau tunggu ~12 detik  
4. Buka email → cek HTML / Text / unduh EML / lampiran  

### C. Admin

1. https://admin.yourdomain.com → login  
2. Stats domain/mailbox/email terisi  
3. Ubah TTL / settings → Save  
4. **Buka Tempmail** → tab baru inbox  

### D. Keamanan login

1. Sengaja password salah beberapa kali  
2. Setelah 5 gagal → pesan lock / HTTP 429  
3. Tunggu lock berakhir atau clear rate-limit key di D1 (advanced)

---

# OPERASIONAL

## Menambah domain email baru (tanpa redeploy kode)

1. Di Cloudflare: zone domain baru → Email Routing enable → catch-all → Worker `tempmail-api`  
2. Di Admin → Domains → tambah `domain-baru.com`  
3. Langsung muncul di dropdown user  

## Update kode nanti

```bash
# Worker
cd worker
# edit source...
npx wrangler deploy

# Frontend (jika UI berubah atau VITE_API_BASE berubah)
cd frontend
# edit .env.production jika perlu
npm run build
npx wrangler pages deploy dist --project-name=tempmail
```

## Ganti password admin

Login admin → Settings → **New password** (≥ 8) → Save.

## TTL & storage

| Setting | Default | Keterangan |
|---------|---------|------------|
| TTL | 24 jam | Cron tiap jam hapus email & mailbox lebih tua |
| Max attachment | 2 MB | Disimpan base64 di D1; oversize meta saja tanpa konten |
| Polling UI | 12 detik | Short-polling |

## Proteksi admin (built-in)

- Password: PBKDF2-SHA256 100k iter  
- Session token 12 jam di D1  
- Rate limit: 5 gagal / IP / 15 menit → lock 30 menit  
- Delay acak 200–450 ms per login/setup  
- Origin admin wajib cocok `ALLOWED_ADMIN_ORIGINS`  
- Host publik tidak expose route admin  

### Opsional ekstra (disarankan)

Cloudflare Dashboard → **Security** → **WAF** → Rate limiting rule:

- Target: `tempmail-api.<subdomain>.workers.dev/api/admin/login`  
- Limit: mis. 10 request / menit / IP  
- Action: Block  

---

# API RINGKAS

Base: `https://tempmail-api.<subdomain>.workers.dev`

## Publik

| Method | Path | Header | Ket |
|--------|------|--------|-----|
| GET | `/api/health` | — | Health |
| GET | `/api/domains` | — | Domain aktif |
| POST | `/api/mailbox` | — | Body `{ username?, domain? }` |
| GET | `/api/mailbox/:address` | `X-Mailbox-Token` | Info mailbox |
| DELETE | `/api/mailbox/:address` | `X-Mailbox-Token` | Hapus |
| GET | `/api/mailbox/:address/emails` | `X-Mailbox-Token` | List |
| GET | `/api/mailbox/:address/emails/:id` | `X-Mailbox-Token` | Detail |
| GET | `/api/mailbox/:address/emails/:id/raw` | `X-Mailbox-Token` | EML |
| GET | `/api/mailbox/:address/emails/:id/attachments/:idx` | `X-Mailbox-Token` | File |

## Admin

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/admin/status` | — |
| POST | `/api/admin/setup` | Origin admin |
| POST | `/api/admin/login` | Origin admin |
| POST | `/api/admin/logout` | Bearer |
| GET | `/api/admin/stats` | Bearer |
| GET/PUT | `/api/admin/settings` | Bearer |
| GET/POST | `/api/admin/domains` | Bearer |
| PATCH/DELETE | `/api/admin/domains/:id` | Bearer |

Header admin: `Authorization: Bearer <token>`

---

# TROUBLESHOOTING

| Gejala | Penyebab umum | Perbaikan |
|--------|----------------|-----------|
| Domain UI tampil JSON API | Domain terpasang ke Worker | Lepas dari Worker; pasang di Pages |
| CORS error di browser | Origin tidak di `ALLOWED_*` | Tambah origin exact + `wrangler deploy` |
| `NO_DOMAINS` / tidak bisa buat email | Belum ada domain aktif di admin | Admin → add `yourdomain.com` |
| Email tidak masuk | Email Routing / MX / catch-all salah | Cek Email Routing → Worker; domain di admin sama |
| Frontend API 404 / salah host | `VITE_API_BASE` salah atau lupa rebuild | Perbaiki `.env.production` → build → deploy Pages |
| Admin 403 HTML Cloudflare | DNS / Access / WAF / domain belum Active | Cek Custom domains Pages, DNS, Zero Trust Access |
| Login invalid terus | Hash rusak / belum reset | DELETE admin keys di D1 remote + setup ulang |
| Login 429 | Rate limit | Tunggu lock; atau hapus key `rl:admin-login:*` di `admin_settings` |
| Attachment kosong | Melebihi max size | Naikkan max di admin (max 5MB) atau kecilkan file |
| Build TS error DOMPurify | Tipe TrustedHTML | `String(DOMPurify.sanitize(...))` |

### Debug cepat

```bash
# Health API
curl https://tempmail-api.sesuaikan.workers.dev/api/health

# Admin status
curl https://tempmail-api.sesuaikan.workers.dev/api/admin/status

# Header domain UI
curl -I https://tempmail.yourdomain.com
curl -I https://admin.yourdomain.com

# Lihat settings D1
cd worker
npx wrangler d1 execute tempmail --remote --command "SELECT key, substr(value,1,60) FROM admin_settings"
npx wrangler d1 execute tempmail --remote --command "SELECT * FROM domains"
```

---

# CHECKLIST GO-LIVE

- [ ] `wrangler login` OK  
- [ ] D1 `tempmail` dibuat, `database_id` di `wrangler.toml`  
- [ ] `schema.sql` dijalankan `--remote`  
- [ ] Worker deploy, `/api/health` OK  
- [ ] `.env.production` = URL Worker  
- [ ] `npm run build` sukses  
- [ ] Pages deploy project `tempmail`  
- [ ] Custom domain `tempmail.yourdomain.com` Active (Pages)  
- [ ] Custom domain `admin.yourdomain.com` Active (Pages)  
- [ ] Worker **tidak** memegang kedua custom domain UI  
- [ ] `ALLOWED_ORIGINS` / `ALLOWED_ADMIN_ORIGINS` production only  
- [ ] Email Routing catch-all → Worker `tempmail-api`  
- [ ] Admin setup password  
- [ ] Domain `yourdomain.com` ditambah di admin  
- [ ] Tes terima email dari Gmail  
- [ ] Tombol Admin tidak ada di inbox publik  
- [ ] Tombol **Buka Tempmail** ada di admin  

---

# KEAMANAN RINGKAS

- Jangan commit file `.env.production`  
- Password admin kuat + unik  
- Pertimbangkan WAF rate limit pada `/api/admin/login`  
- URL `*.pages.dev` tetap ada di CF; kunci fungsional lewat CORS (hanya custom domain di allowlist)  
- Jangan share mailbox token user  
- Lampiran besar lebih aman ke R2 di masa depan (saat ini D1 base64)

---

# LISENSI

MIT — bebas dipakai personal maupun komersial.

---

## Bantuan cepat perintah (copy-paste production)

```bash
# === WORKER ===
cd worker
npm install
npx wrangler d1 create tempmail
# edit wrangler.toml → database_id + ALLOWED_* 
npx wrangler d1 execute tempmail --remote --file=../schema.sql
npx wrangler deploy

# === FRONTEND ===
cd ../frontend
npm install
# buat .env.production berisi VITE_API_BASE=https://tempmail-api.<subdomain>.workers.dev
npm run build
npx wrangler pages deploy dist --project-name=tempmail

# Lalu di Dashboard:
# 1) Pages custom domains: tempmail.yourdomain.com + admin.yourdomain.com
# 2) Email Routing catch-all → Worker tempmail-api
# 3) https://admin.yourdomain.com → setup + add domain yourdomain.com
# 4) https://tempmail.yourdomain.com → tes inbox + kirim email
```

Selesai. Stack production Tempmail Anda setara konfigurasi yang sudah jalan di `yourdomain.com`.
