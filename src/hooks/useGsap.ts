import { useEffect, useLayoutEffect, useRef } from 'react';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Lightweight scoped animation container hook with automatic lifecycle management.
 * 100% native Web Animations standard (Zero external dependencies).
 */
export function useGsapContext<T extends HTMLElement = HTMLDivElement>(
  animationCallback: (container: T | null) => void,
  dependencies: any[] = []
) {
  const containerRef = useRef<T | null>(null);

  useIsomorphicLayoutEffect(() => {
    animationCallback(containerRef.current);
  }, dependencies);

  return containerRef;
}

export function usePageTransition(triggerKey: any) {
  const pageRef = useRef<HTMLDivElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!pageRef.current) return;
    pageRef.current.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
    );
  }, [triggerKey]);

  return pageRef;
}
