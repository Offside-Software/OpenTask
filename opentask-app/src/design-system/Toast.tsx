import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeouts = useRef<{ [key: string]: ReturnType<typeof setTimeout> }>({});

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    if (timeouts.current[id]) {
      clearTimeout(timeouts.current[id]);
      delete timeouts.current[id];
    }
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    timeouts.current[id] = setTimeout(() => {
      removeToast(id);
    }, 5000);
  }, [removeToast]);

  const typeConfig = {
    success: {
      icon: CheckCircle2,
      iconColor: 'text-emerald-500',
      border: 'border-emerald-500/20'
    },
    error: {
      icon: AlertCircle,
      iconColor: 'text-destructive',
      border: 'border-destructive/20'
    },
    warning: {
      icon: AlertTriangle,
      iconColor: 'text-amber-500',
      border: 'border-amber-500/20'
    },
    info: {
      icon: Info,
      iconColor: 'text-primary',
      border: 'border-primary/20'
    }
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => {
          const config = typeConfig[toast.type] || typeConfig.info;
          const Icon = config.icon;

          return (
            <div
              key={toast.id}
              className={cn(
                "pointer-events-auto flex items-center gap-3 p-3.5 rounded-lg border bg-card/95 text-card-foreground shadow-lg backdrop-blur-sm animate-in slide-in-from-bottom-2 fade-in duration-200",
                config.border
              )}
            >
              <Icon size={18} className={cn("shrink-0", config.iconColor)} strokeWidth={2} />
              <p className="text-sm font-medium flex-1 text-foreground">{toast.message}</p>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                aria-label="Dismiss toast"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
};
