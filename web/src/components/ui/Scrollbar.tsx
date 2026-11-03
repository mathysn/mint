import { useEffect, useRef, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import s from './scrollbar.module.css';

const MIN_THUMB = 28;
const IDLE_MS = 900;
/** A pointer this close to the right edge of a scroller shows its thumb. */
const EDGE_PX = 18;

type Target = 'page' | { current: HTMLElement | null };

/**
 * Overlay thumb (DESIGN.md §2, scrollbars): native bars are hidden everywhere, so this one takes
 * no layout width. It shows while scrolling or when the pointer nears the edge, and can be dragged.
 * Scrolling itself stays native (wheel, keyboard, touch, sticky elements).
 */
function Thumb({ target, fixed, mobile }: { target: Target; fixed?: boolean; mobile?: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    const el = target === 'page' ? document.scrollingElement : target.current;
    if (!track || !thumb || !(el instanceof HTMLElement)) return;
    const events: HTMLElement | Window = target === 'page' ? window : el;
    let frame = 0;
    let hideTimer = 0;
    let near = false;
    let dragging = false;

    const layout = () => {
      frame = 0;
      const max = el.scrollHeight - el.clientHeight;
      const length = track.clientHeight;
      if (max <= 1 || length === 0) {
        track.dataset.off = '';
        return;
      }
      delete track.dataset.off;
      const size = Math.max(MIN_THUMB, (el.clientHeight / el.scrollHeight) * length);
      const offset = (Math.min(Math.max(el.scrollTop, 0), max) / max) * (length - size);
      thumb.style.height = `${size}px`;
      thumb.style.transform = `translateY(${offset}px)`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(layout);
    };
    const show = () => {
      track.dataset.visible = '';
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (!near && !dragging) delete track.dataset.visible;
      }, IDLE_MS);
    };
    const onScroll = () => {
      schedule();
      show();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const right = target === 'page' ? window.innerWidth : el.getBoundingClientRect().right;
      const isNear = right - e.clientX <= EDGE_PX;
      if (isNear && !near) schedule();
      near = isNear;
      if (near) show();
    };
    const onPointerLeave = () => {
      near = false;
      show();
    };
    const onThumbDown = (e: PointerEvent) => {
      e.preventDefault();
      dragging = true;
      track.dataset.dragging = '';
      thumb.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startTop = el.scrollTop;
      const move = (ev: PointerEvent) => {
        const room = track.clientHeight - thumb.offsetHeight;
        if (room > 0) el.scrollTop = startTop + ((ev.clientY - startY) * (el.scrollHeight - el.clientHeight)) / room;
      };
      const up = () => {
        dragging = false;
        delete track.dataset.dragging;
        thumb.removeEventListener('pointermove', move);
        thumb.removeEventListener('pointerup', up);
        thumb.removeEventListener('pointercancel', up);
        show();
      };
      thumb.addEventListener('pointermove', move);
      thumb.addEventListener('pointerup', up);
      thumb.addEventListener('pointercancel', up);
    };

    // Content changes size without scrolling: watch the scroller and what it holds.
    const resize = new ResizeObserver(schedule);
    const watchChildren = () => {
      resize.disconnect();
      resize.observe(track);
      if (target === 'page') resize.observe(document.body);
      else {
        resize.observe(el);
        for (const child of el.children) resize.observe(child);
      }
    };
    watchChildren();
    const mutations = new MutationObserver(() => {
      watchChildren();
      schedule();
    });
    if (target !== 'page') mutations.observe(el, { childList: true });

    events.addEventListener('scroll', onScroll, { passive: true });
    const hoverZone: HTMLElement | Window = target === 'page' ? window : (el.parentElement ?? el);
    hoverZone.addEventListener('pointermove', onPointerMove as EventListener, { passive: true });
    if (target !== 'page') hoverZone.addEventListener('pointerleave', onPointerLeave);
    thumb.addEventListener('pointerdown', onThumbDown);
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(hideTimer);
      resize.disconnect();
      mutations.disconnect();
      events.removeEventListener('scroll', onScroll);
      hoverZone.removeEventListener('pointermove', onPointerMove as EventListener);
      hoverZone.removeEventListener('pointerleave', onPointerLeave);
      thumb.removeEventListener('pointerdown', onThumbDown);
    };
  }, [target]);

  return (
    <div ref={trackRef} aria-hidden="true" className={`${s.track} ${fixed ? s.fixed : ''} ${mobile ? s.aboveTabs : ''}`} data-off="">
      <div ref={thumbRef} className={s.thumb} />
    </div>
  );
}

/** Thumb of the page itself (the document scrolls), mounted once by the shell. */
export function PageScrollbar({ mobile }: { mobile?: boolean }) {
  return <Thumb target="page" fixed mobile={mobile} />;
}

interface ScrollAreaProps extends Omit<HTMLAttributes<HTMLElement>, 'style' | 'className'> {
  children: ReactNode;
  /** Outer frame: give it the size, position (sticky…) and max height. */
  style?: CSSProperties;
  className?: string;
  /** The scrolling element itself (layout of the content: flex, gap, padding…). */
  viewportStyle?: CSSProperties;
  viewportClassName?: string;
  viewportRef?: Ref<HTMLElement>;
  /** Tag of the scrolling element (nav, aside, ul…). */
  as?: ElementType;
}

/** A vertical scroller with the overlay thumb. Attributes (aria, role, id) go on the scrolling element. */
export function ScrollArea({ children, style, className, viewportStyle, viewportClassName, viewportRef, as: Tag = 'div', ...rest }: ScrollAreaProps) {
  const inner = useRef<HTMLElement | null>(null);
  const setRef = (node: HTMLElement | null) => {
    inner.current = node;
    if (typeof viewportRef === 'function') viewportRef(node);
    else if (viewportRef) (viewportRef as { current: HTMLElement | null }).current = node;
  };
  return (
    <div className={`${s.area} ${className ?? ''}`} style={style}>
      <Tag ref={setRef} className={`${s.viewport} ${viewportClassName ?? ''}`} style={viewportStyle} {...rest}>
        {children}
      </Tag>
      <Thumb target={inner} />
    </div>
  );
}
