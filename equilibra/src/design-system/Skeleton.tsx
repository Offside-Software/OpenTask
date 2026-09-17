import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circle' | 'rectangle';
  width?: string | number;
  height?: string | number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'rectangle',
  width,
  height,
}) => {
  const baseClass = 'animate-pulse bg-[#1E2227] rounded-none border border-neutral-700';
  const variantClass = variant === 'circle' ? 'rounded-none border-2 border-black' : variant === 'text' ? 'h-3 w-3/4' : '';
  
  const style: React.CSSProperties = {
    width: width,
    height: height,
  };

  return (
    <div 
      className={`${baseClass} ${variantClass} ${className}`} 
      style={style}
      aria-hidden="true"
    />
  );
};

export const CardSkeleton: React.FC = () => (
  <div className="p-5 rounded-none border-2 border-neutral-800 bg-[#141619] shadow-[4px_4px_0px_0px_#000000] flex flex-col justify-between h-40">
    <div>
      <div className="flex justify-between items-start mb-3">
        <Skeleton width="60%" height={16} />
        <Skeleton width="20%" height={12} />
      </div>
      <div className="space-y-2">
        <Skeleton width="90%" height={10} />
        <Skeleton width="40%" height={10} />
      </div>
    </div>
    <div className="flex justify-between items-end gap-4 mt-2">
      <Skeleton width="70%" height={8} />
      <Skeleton variant="circle" width={28} height={28} />
    </div>
  </div>
);
