import { useEffect } from 'react';

export function useReveal() {
  useEffect(() => {
    // IntersectionObserver (threshold 0.15) for .reveal elements
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.15 }
    );

    const observeReveals = () => {
      document.querySelectorAll('.reveal:not(.visible)').forEach((el) => {
        observer.observe(el);
      });
    };

    observeReveals();

    // Mousemove handler setting --mx and --my on .spot elements
    const handleMouseMove = (e: MouseEvent) => {
      const spots = document.querySelectorAll<HTMLElement>('.spot');
      spots.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (
          e.clientX >= rect.left - 60 &&
          e.clientX <= rect.right + 60 &&
          e.clientY >= rect.top - 60 &&
          e.clientY <= rect.bottom + 60
        ) {
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          el.style.setProperty('--mx', `${x}px`);
          el.style.setProperty('--my', `${y}px`);
        }
      });
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    // Re-observe on DOM changes to support dynamic routing/tabs
    const mutationObserver = new MutationObserver(() => {
      observeReveals();
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);
}
