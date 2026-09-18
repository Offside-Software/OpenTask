import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';

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

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-8 right-8 z-[9999] flex flex-col gap-3 max-w-md w-full sm:w-auto">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 p-4 rounded-none border-2 border-black shadow-[4px_4px_0px_0px_#000000] font-mono animate-in slide-in-from-right-full duration-150 ${
              toast.type === 'success' ? 'bg-[#00FF66] text-black' :
              toast.type === 'error' ? 'bg-[#FF3333] text-white' :
              toast.type === 'warning' ? 'bg-[#FFE600] text-black' :
              'bg-[#00E5FF] text-black'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 size={18} strokeWidth={2.5} />}
            {toast.type === 'error' && <AlertCircle size={18} strokeWidth={2.5} />}
            {toast.type === 'warning' && <AlertCircle size={18} strokeWidth={2.5} />}
            {toast.type === 'info' && <Info size={18} strokeWidth={2.5} />}

            <p className="text-[12px] font-bold uppercase tracking-wider flex-1">{toast.message}</p>

            <button
              onClick={() => removeToast(toast.id)}
              className="p-1 border border-black hover:bg-black hover:text-white transition-colors cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        ))}
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
