import React from 'react';
import './LoadingScreen.css';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface LoadingScreenProps {
  message?: string;
  subtext?: string;
  fullscreen?: boolean;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  message = 'Loading OpenTask…',
  subtext,
  fullscreen = true,
}) => {
  return (
    <div
      className={cn(
        fullscreen ? 'min-h-screen w-full fixed inset-0 z-50' : 'min-h-[calc(100vh-14rem)] w-full flex-1',
        'bg-background/80 backdrop-blur-xs text-foreground flex items-center justify-center p-4 select-none'
      )}
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-xl shadow-lg p-6 flex flex-col items-center">
        <div className="mb-4 text-primary">
          <Loader2 size={32} className="animate-spin" />
        </div>

        <h3 className="text-foreground font-semibold text-sm text-center mb-1">
          {message}
        </h3>

        <p className="text-muted-foreground text-xs text-center">
          {subtext || 'Synchronizing with OpenTask services…'}
        </p>
      </div>
    </div>
  );
};
