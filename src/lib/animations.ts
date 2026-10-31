/**
 * ==============================================================================
 * ASOPALAV ERP — ULTRA-LIGHTWEIGHT GPU-ACCELERATED HARDWARE ANIMATIONS
 * ==============================================================================
 * Powered 100% by the native W3C Web Animations API (element.animate) and GPU
 * composited CSS transitions. Zero external animation bundle overhead (0 kB GSAP).
 * ==============================================================================
 */

export const ANIM_CONFIG = {
  duration: {
    fast: 150,
    normal: 250,
    smooth: 350,
    counter: 600,
  },
  ease: {
    default: 'cubic-bezier(0.16, 1, 0.3, 1)', // power2.out equivalent
    snappy: 'cubic-bezier(0.22, 1, 0.36, 1)', // power3.out equivalent
    modal: 'cubic-bezier(0.34, 1.56, 0.64, 1)', // back.out(1.15) equivalent
    in: 'cubic-bezier(0.7, 0, 0.84, 0)',
    smoothInOut: 'cubic-bezier(0.45, 0, 0.55, 1)',
    bounce: 'cubic-bezier(0.34, 1.7, 0.64, 1)',
  },
};

/**
 * Animate page entrance transition (Start to Bottom)
 */
export function animatePageEntrance(target: HTMLElement | null, onComplete?: () => void) {
  if (!target) return;
  const anim = target.animate(
    [
      { opacity: 0, transform: 'translateY(-26px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    {
      duration: ANIM_CONFIG.duration.smooth,
      easing: ANIM_CONFIG.ease.snappy,
      fill: 'forwards',
    }
  );
  if (onComplete) anim.onfinish = onComplete;
}

/**
 * Animate page entrance from top downward
 */
export function animatePageEntranceStartToBottom(target: HTMLElement | null, onComplete?: () => void) {
  if (!target) return;
  const anim = target.animate(
    [
      { opacity: 0, transform: 'translateY(-28px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
    {
      duration: 320,
      easing: ANIM_CONFIG.ease.snappy,
      fill: 'forwards',
    }
  );
  if (onComplete) anim.onfinish = onComplete;
}

/**
 * Animate page exit towards top
 */
export function animatePageExitEndToTop(target: HTMLElement | null, onComplete?: () => void) {
  if (!target) {
    if (onComplete) onComplete();
    return;
  }
  const anim = target.animate(
    [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-28px)' },
    ],
    {
      duration: 180,
      easing: ANIM_CONFIG.ease.in,
      fill: 'forwards',
    }
  );
  if (onComplete) anim.onfinish = onComplete;
}

/**
 * Animate modal entrance dialog with backdrop
 */
export function animateModalOpen(modal: HTMLElement | null, backdrop?: HTMLElement | null) {
  if (backdrop) {
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: ANIM_CONFIG.duration.normal,
      easing: 'ease-out',
      fill: 'forwards',
    });
  }
  if (modal) {
    modal.animate(
      [
        { opacity: 0, transform: 'scale(0.95) translateY(-8px)' },
        { opacity: 1, transform: 'scale(1) translateY(0)' },
      ],
      {
        duration: ANIM_CONFIG.duration.normal,
        easing: ANIM_CONFIG.ease.modal,
        fill: 'forwards',
      }
    );
  }
}

/**
 * Animate modal close dialog
 */
export function animateModalClose(
  modal: HTMLElement | null,
  backdrop: HTMLElement | null | undefined,
  onComplete: () => void
) {
  let doneCount = 0;
  const total = (backdrop ? 1 : 0) + (modal ? 1 : 0);
  if (total === 0) {
    onComplete();
    return;
  }

  const checkDone = () => {
    doneCount++;
    if (doneCount >= total) onComplete();
  };

  if (backdrop) {
    const anim = backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: ANIM_CONFIG.duration.fast,
      easing: ANIM_CONFIG.ease.in,
      fill: 'forwards',
    });
    anim.onfinish = checkDone;
  }
  if (modal) {
    const anim = modal.animate(
      [
        { opacity: 1, transform: 'scale(1) translateY(0)' },
        { opacity: 0, transform: 'scale(0.96) translateY(-4px)' },
      ],
      {
        duration: ANIM_CONFIG.duration.fast,
        easing: ANIM_CONFIG.ease.in,
        fill: 'forwards',
      }
    );
    anim.onfinish = checkDone;
  }
}

/**
 * Animate slide-over drawer entrance
 */
export function animateDrawerOpen(
  drawer: HTMLElement | null,
  backdrop?: HTMLElement | null,
  isMobile: boolean = typeof window !== 'undefined' ? window.innerWidth < 768 : false
) {
  if (backdrop) {
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: ANIM_CONFIG.duration.smooth,
      easing: 'ease-out',
      fill: 'forwards',
    });
  }
  if (drawer) {
    const fromTransform = isMobile ? 'translateY(100%)' : 'translateX(100%)';
    const toTransform = isMobile ? 'translateY(0)' : 'translateX(0)';
    drawer.animate(
      [
        { opacity: 0.8, transform: fromTransform },
        { opacity: 1, transform: toTransform },
      ],
      {
        duration: ANIM_CONFIG.duration.smooth,
        easing: ANIM_CONFIG.ease.snappy,
        fill: 'forwards',
      }
    );
  }
}

/**
 * Animate slide-over drawer exit
 */
export function animateDrawerClose(
  drawer: HTMLElement | null,
  backdrop: HTMLElement | null | undefined,
  onComplete: () => void,
  isMobile: boolean = typeof window !== 'undefined' ? window.innerWidth < 768 : false
) {
  let doneCount = 0;
  const total = (backdrop ? 1 : 0) + (drawer ? 1 : 0);
  if (total === 0) {
    onComplete();
    return;
  }

  const checkDone = () => {
    doneCount++;
    if (doneCount >= total) onComplete();
  };

  if (backdrop) {
    const anim = backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: ANIM_CONFIG.duration.fast,
      easing: ANIM_CONFIG.ease.in,
      fill: 'forwards',
    });
    anim.onfinish = checkDone;
  }
  if (drawer) {
    const toTransform = isMobile ? 'translateY(100%)' : 'translateX(100%)';
    const anim = drawer.animate(
      [
        { opacity: 1, transform: isMobile ? 'translateY(0)' : 'translateX(0)' },
        { opacity: 0.5, transform: toTransform },
      ],
      {
        duration: ANIM_CONFIG.duration.normal,
        easing: ANIM_CONFIG.ease.in,
        fill: 'forwards',
      }
    );
    anim.onfinish = checkDone;
  }
}

/**
 * Stagger entrance of card elements
 */
export function animateStaggerCards(container: HTMLElement | null, selector: string = '.stagger-item', stagger = 0.04) {
  if (!container) return;
  const items = container.querySelectorAll<HTMLElement>(selector);
  if (!items.length) return;

  items.forEach((item, index) => {
    item.animate(
      [
        { opacity: 0, transform: 'translateY(12px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      {
        duration: ANIM_CONFIG.duration.smooth,
        delay: index * (stagger * 1000),
        easing: ANIM_CONFIG.ease.default,
        fill: 'forwards',
      }
    );
  });
}

/**
 * Stagger entrance of table rows
 */
export function animateStaggerRows(container: HTMLElement | null, selector: string = 'tbody tr', stagger = 0.02) {
  if (!container) return;
  const rows = container.querySelectorAll<HTMLElement>(selector);
  if (!rows.length) return;

  rows.forEach((row, index) => {
    row.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      {
        duration: ANIM_CONFIG.duration.normal,
        delay: Math.min(index * (stagger * 1000), 300),
        easing: ANIM_CONFIG.ease.default,
        fill: 'forwards',
      }
    );
  });
}

/**
 * Shake an element horizontally (e.g., wrong PIN code or validation failure)
 */
export function animateShake(target: HTMLElement | null) {
  if (!target) return;
  target.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-8px)' },
      { transform: 'translateX(8px)' },
      { transform: 'translateX(-6px)' },
      { transform: 'translateX(6px)' },
      { transform: 'translateX(-3px)' },
      { transform: 'translateX(0)' },
    ],
    {
      duration: 320,
      easing: 'ease-in-out',
    }
  );
}

/**
 * Smooth financial number counter
 */
export function animateNumberCounter(
  target: HTMLElement | null,
  endValue: number,
  formatter?: (val: number) => string,
  duration: number = 600
) {
  if (!target) return;
  const startVal = 0;
  const startTime = performance.now();

  const tick = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(startVal + (endValue - startVal) * easeOut);

    target.textContent = formatter ? formatter(current) : current.toLocaleString('en-IN');

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      target.textContent = formatter ? formatter(endValue) : endValue.toLocaleString('en-IN');
    }
  };

  requestAnimationFrame(tick);
}

/**
 * Animate error banner entrance with spring slide-down and subtle shake
 */
export function animateErrorBanner(target: HTMLElement | null) {
  if (!target) return;
  target.animate(
    [
      { opacity: 0, transform: 'translateY(-16px) scale(0.98)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ],
    {
      duration: 280,
      easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
      fill: 'forwards',
    }
  );
}

/**
 * Animate success banner / pulse entrance
 */
export function animateSuccessBanner(target: HTMLElement | null) {
  if (!target) return;
  target.animate(
    [
      { opacity: 0, transform: 'translateY(-8px) scale(0.94)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ],
    {
      duration: 320,
      easing: 'cubic-bezier(0.34, 1.5, 0.64, 1)',
      fill: 'forwards',
    }
  );
}

/**
 * Animate verified seal stamp
 */
export function animateStamp(target: HTMLElement | null) {
  if (!target) return;
  target.animate(
    [
      { opacity: 0, transform: 'scale(1.8) rotate(-12deg)' },
      { opacity: 1, transform: 'scale(1) rotate(0deg)' },
    ],
    {
      duration: 380,
      easing: 'cubic-bezier(0.34, 1.8, 0.64, 1)',
      fill: 'forwards',
    }
  );
}

/**
 * Animate smooth progress bar fill
 */
export function animateProgressBar(target: HTMLElement | null, percentage: number, duration: number = 400) {
  if (!target) return;
  target.style.transition = `width ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`;
  target.style.width = `${Math.min(Math.max(percentage, 0), 100)}%`;
}

/**
 * Flash emerald highlight on freshly synchronized or updated rows
 */
export function animateRowHighlight(target: HTMLElement | null) {
  if (!target) return;
  target.animate(
    [
      { backgroundColor: 'rgba(62, 207, 142, 0.25)' },
      { backgroundColor: 'transparent' },
    ],
    {
      duration: 1500,
      easing: 'ease-out',
    }
  );
}

/**
 * Animate floating toast notification
 */
export function animateToast(target: HTMLElement | null) {
  if (!target) return;
  target.animate(
    [
      { opacity: 0, transform: 'translateY(20px) scale(0.9)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ],
    {
      duration: 250,
      easing: ANIM_CONFIG.ease.snappy,
      fill: 'forwards',
    }
  );
}

export default null;
