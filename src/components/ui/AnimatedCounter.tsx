import React, { useEffect, useRef, useState } from 'react';
import { formatINR } from '@/lib/utils';

interface AnimatedCounterProps {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  isCurrency?: boolean;
  className?: string;
}

/**
 * GPU-friendly 60/120fps requestAnimationFrame numeric counter.
 * Zero external library dependencies (0 kB bundle size).
 */
export const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  value,
  prefix = '',
  suffix = '',
  duration = 0.5,
  isCurrency = false,
  className = '',
}) => {
  const [displayValue, setDisplayValue] = useState<number>(Number(value) || 0);
  const prevValueRef = useRef<number>(Number(value) || 0);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const startVal = prevValueRef.current;
    const endVal = Number(value) || 0;

    if (startVal === endVal) {
      setDisplayValue(endVal);
      return;
    }

    const startTime = performance.now();
    const durationMs = duration * 1000;

    const tick = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      // Ease out cubic
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startVal + (endVal - startVal) * easeOut);

      setDisplayValue(current);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        setDisplayValue(endVal);
        prevValueRef.current = endVal;
      }
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [value, duration]);

  return (
    <span className={className}>
      {isCurrency ? formatINR(displayValue) : `${prefix}${displayValue.toLocaleString('en-IN')}${suffix}`}
    </span>
  );
};

export default AnimatedCounter;
