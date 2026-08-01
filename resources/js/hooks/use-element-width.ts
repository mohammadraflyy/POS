import { useEffect, useRef, useState } from 'react';

/** Tracks an element's rendered width, for grids whose column library needs a pixel width to fill available space. */
export function useElementWidth<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = ref.current;

        if (!el) {
            return;
        }

        const observer = new ResizeObserver((entries) => {
            setWidth(entries[0].contentRect.width);
        });
        observer.observe(el);

        return () => observer.disconnect();
    }, []);

    return [ref, width] as const;
}
