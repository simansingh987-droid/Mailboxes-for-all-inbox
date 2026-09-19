import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X, Mail } from 'lucide-react';
import { avatarTone, initials } from '../lib/format.js';

export function Logo({ size = 36, withText = true, subtitle, light = false }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <div
        className="relative flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white to-silver-200 shadow-card ring-1 ring-black/5 dark:from-silver-200 dark:to-silver-400"
        style={{ width: size, height: size }}
      >
        <img src="/logo.webp" alt="AskCruz" className="w-[78%] object-contain drop-shadow-sm" />
      </div>
      {withText && (
        <div className="leading-tight">
          <div className={`font-display text-[15px] font-extrabold tracking-tight ${light ? 'text-white' : 'text-brand-900 dark:text-white'}`}>
            AskCruz <span className={light ? 'silver-text' : 'text-brand-500 dark:text-silver-300'}>Mailbox</span>
          </div>
          {subtitle && <div className={`text-[11px] ${light ? 'text-brand-200' : 'text-slate-500 dark:text-slate-400'}`}>{subtitle}</div>}
        </div>
      )}
    </div>
  );
}

export function Avatar({ person, size = 36, className = '' }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white ring-2 ring-white dark:ring-ink-900 ${avatarTone(person?.address || person?.name)} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(person)}
    </div>
  );
}

export function EmptyState({ icon: Icon = Mail, title, children }) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-10 text-center animate-fade-in">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100 dark:bg-brand-900/40 dark:text-brand-300 dark:ring-brand-800">
        <Icon size={24} />
      </div>
      <div className="font-display text-base font-bold text-slate-800 dark:text-white">{title}</div>
      {children && <div className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{children}</div>}
    </div>
  );
}

export function Spinner({ size = 16, className = '' }) {
  return (
    <svg className={`animate-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---------- toasts ----------

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id));
  const push = useCallback((message, { type = 'success', title, action, duration = 4000 } = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, message, type, title, action }]);
    if (duration) setTimeout(() => dismiss(id), duration);
  }, []);
  const icons = { success: CheckCircle2, error: AlertTriangle, info: Info, mail: Mail };
  const tones = {
    success: 'text-emerald-500',
    error: 'text-rose-500',
    info: 'text-brand-400',
    mail: 'text-brand-400',
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[80] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 sm:left-auto sm:right-5 sm:translate-x-0">
        {toasts.map((t) => {
          const Icon = icons[t.type] || Info;
          return (
            <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 bg-white/95 p-3.5 shadow-xl backdrop-blur animate-slide-up dark:border-ink-600 dark:bg-ink-800/95">
              <Icon size={18} className={`mt-0.5 shrink-0 ${tones[t.type]}`} />
              <div className="min-w-0 flex-1 text-sm">
                {t.title && <div className="font-semibold text-slate-900 dark:text-white">{t.title}</div>}
                <div className="text-slate-600 dark:text-slate-300 break-words">{t.message}</div>
                {t.action && (
                  <button className="mt-1.5 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => { t.action.onClick(); dismiss(t.id); }}>
                    {t.action.label}
                  </button>
                )}
              </div>
              <button className="text-slate-400 hover:text-slate-700 dark:hover:text-white" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function Modal({ open, onClose, children, className = '' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-ink-950/50 p-4 pt-[10vh] backdrop-blur-sm animate-fade-in" onMouseDown={onClose}>
      <div className={`w-full rounded-2xl border border-slate-200 bg-white shadow-2xl animate-slide-up dark:border-ink-600 dark:bg-ink-850 ${className}`} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
