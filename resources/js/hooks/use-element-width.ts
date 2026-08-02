import { useCallback, useRef, useState } from 'react';

/** Tracks an element's rendered width, for grids whose column library needs a pixel width to fill available space. */
export function useElementWidth<T extends HTMLElement>() {
    const [width, setWidth] = useState(0);
    const observerRef = useRef<ResizeObserver | null>(null);

    const ref = useCallback((el: T | null) => {
        observerRef.current?.disconnect();

        if (!el) {
            return;
        }

        observerRef.current = new ResizeObserver((entries) => {
            setWidth(entries[0].contentRect.width);
        });
        observerRef.current.observe(el);
    }, []);

    return [ref, width] as const;
}
