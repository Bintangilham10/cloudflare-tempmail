import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  downloadWithToken,
  type EmailDetail as Detail,
  type EmailListItem,
} from "../lib/api";
import { getMailbox, setMailbox, type StoredMailbox } from "../lib/storage";
import { usePolling } from "../hooks/usePolling";
import { AddressBar } from "../components/inbox/AddressBar";
import { EmailList } from "../components/inbox/EmailList";
import { EmailDetail } from "../components/inbox/EmailDetail";
import type { Lang } from "../lib/i18n";
import type { ToastKind } from "../components/ui/Toast";

export function HomePage({
  lang,
  t,
  toast,
}: {
  lang: Lang;
  t: (k: any) => string;
  toast: (message: string, kind?: ToastKind) => void;
}) {
  const [domains, setDomains] = useState<
    Array<{ id: number; domain_name: string }>
  >([]);
  const [mailbox, setMailboxState] = useState<StoredMailbox | null>(() =>
    getMailbox(),
  );
  const [emails, setEmails] = useState<EmailListItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const titleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const originalTitle = useRef(document.title);

  // Flash document title when new mail arrives, restore on window focus
  const flashTitle = useCallback((count: number) => {
    if (titleIntervalRef.current) clearInterval(titleIntervalRef.current);
    const msg = `📬 ${count} new email${count > 1 ? "s" : ""}`;
    let toggle = false;
    titleIntervalRef.current = setInterval(() => {
      document.title = toggle ? originalTitle.current : msg;
      toggle = !toggle;
    }, 1000);
  }, []);

  const stopFlash = useCallback(() => {
    if (titleIntervalRef.current) {
      clearInterval(titleIntervalRef.current);
      titleIntervalRef.current = null;
    }
    document.title = originalTitle.current;
  }, []);

  useEffect(() => {
    window.addEventListener("focus", stopFlash);
    return () => {
      window.removeEventListener("focus", stopFlash);
      stopFlash();
    };
  }, [stopFlash]);

  const ensureMailbox = useCallback(async () => {
    setBusy(true);
    try {
      const domainList = await api.listDomains();
      setDomains(domainList);

      if (!domainList.length) {
        setBootstrapped(true);
        return;
      }

      const existing = getMailbox();
      if (existing) {
        try {
          await api.getMailbox(existing.address, existing.token);
          setMailboxState(existing);
          setBootstrapped(true);
          return;
        } catch {
          setMailbox(null);
        }
      }

      const created = await api.createMailbox();
      const stored = {
        address: created.address,
        token: created.token,
        created_at: created.created_at,
      };
      setMailbox(stored);
      setMailboxState(stored);
      setEmails([]);
      setSelectedId(null);
      setDetail(null);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("errorGeneric");
      toast(msg, "error");
    } finally {
      setBusy(false);
      setBootstrapped(true);
    }
  }, [t, toast]);

  useEffect(() => {
    void ensureMailbox();
  }, [ensureMailbox]);

  const refreshEmails = useCallback(async () => {
    const box = getMailbox();
    if (!box) return;
    setFetching(true);
    try {
      const res = await api.listEmails(box.address, box.token);
      setEmails((prev) => {
        const newCount = res.emails.length - prev.length;
        if (prev.length && newCount > 0 && !document.hasFocus()) {
          flashTitle(newCount);
          toast(
            `${newCount} ${newCount > 1 ? "new emails" : "new email"}`,
            "success",
          );
        }
        return res.emails;
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMailbox(null);
        setMailboxState(null);
        await ensureMailbox();
      }
    } finally {
      setFetching(false);
    }
  }, [ensureMailbox, flashTitle, toast]);

  usePolling(refreshEmails, 12_000, bootstrapped && !!mailbox);

  const openEmail = async (id: number) => {
    const box = getMailbox();
    if (!box) return;
    setSelectedId(id);
    setMobileShowDetail(true);
    try {
      const d = await api.getEmail(box.address, box.token, id);
      setDetail(d);
      setEmails((list) =>
        list.map((e) => (e.id === id ? { ...e, is_read: true } : e)),
      );
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("errorGeneric"), "error");
    }
  };

  const createRandom = async () => {
    setBusy(true);
    try {
      const created = await api.createMailbox();
      const stored = {
        address: created.address,
        token: created.token,
        created_at: created.created_at,
      };
      setMailbox(stored);
      setMailboxState(stored);
      setEmails([]);
      setSelectedId(null);
      setDetail(null);
      setMobileShowDetail(false);
      toast(created.address, "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("errorGeneric"), "error");
    } finally {
      setBusy(false);
    }
  };

  const createCustom = async (username: string, domain: string) => {
    setBusy(true);
    try {
      const created = await api.createMailbox({ username, domain });
      const stored = {
        address: created.address,
        token: created.token,
        created_at: created.created_at,
      };
      setMailbox(stored);
      setMailboxState(stored);
      setEmails([]);
      setSelectedId(null);
      setDetail(null);
      setMobileShowDetail(false);
      toast(created.address, "success");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("errorGeneric"), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    const box = getMailbox();
    if (!box) return;
    if (!window.confirm(t("confirmDeleteMailbox"))) return;
    setBusy(true);
    try {
      await api.deleteMailbox(box.address, box.token);
      setMailbox(null);
      setMailboxState(null);
      setEmails([]);
      setDetail(null);
      await createRandom();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("errorGeneric"), "error");
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!mailbox?.address) return;
    try {
      await navigator.clipboard.writeText(mailbox.address);
      toast(t("copied"), "success");
    } catch {
      toast(t("errorGeneric"), "error");
    }
  };

  const handleRaw = async () => {
    if (!mailbox || !detail) return;
    try {
      await downloadWithToken(
        api.rawEmailUrl(mailbox.address, detail.id),
        `email-${detail.id}.eml`,
        mailbox.token,
      );
    } catch {
      toast(t("errorGeneric"), "error");
    }
  };

  const handleAttachment = async (index: number, filename: string) => {
    if (!mailbox || !detail) return;
    try {
      await downloadWithToken(
        api.attachmentUrl(mailbox.address, detail.id, index),
        filename,
        mailbox.token,
      );
    } catch {
      toast(t("attachmentUnavailable"), "error");
    }
  };

  if (!bootstrapped) {
    return (
      <div className="card flex min-h-[320px] items-center justify-center p-8 text-sm text-slate-500">
        {t("loading")}
      </div>
    );
  }

  if (!domains.length) {
    return (
      <div className="card p-8 text-center">
        <h1 className="text-xl font-semibold">{t("appName")}</h1>
        <p className="mt-2 text-sm text-slate-500">{t("noDomains")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {t("appName")}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t("tagline")}
        </p>
      </div>

      <AddressBar
        address={mailbox?.address || null}
        domains={domains}
        busy={busy}
        fetching={fetching}
        t={t}
        onCopy={handleCopy}
        onRefresh={() => void refreshEmails()}
        onRandom={() => void createRandom()}
        onCustom={(u, d) => void createCustom(u, d)}
        onDelete={() => void handleDelete()}
      />

      <div className="card grid min-h-[420px] overflow-hidden md:grid-cols-[minmax(0,22rem)_1fr]">
        <div
          className={`border-slate-100 dark:border-slate-800 md:border-r ${
            mobileShowDetail ? "hidden md:block" : "block"
          }`}
        >
          <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800">
            {t("inbox")} · {emails.length}
          </div>
          <EmailList
            emails={emails}
            selectedId={selectedId}
            lang={lang}
            t={t}
            onSelect={(id) => void openEmail(id)}
          />
        </div>
        <div className={`${mobileShowDetail ? "block" : "hidden md:block"}`}>
          <EmailDetail
            email={detail}
            lang={lang}
            t={t}
            onBack={() => setMobileShowDetail(false)}
            onDownloadRaw={() => void handleRaw()}
            onDownloadAttachment={(i, f) => void handleAttachment(i, f)}
          />
        </div>
      </div>
    </div>
  );
}
