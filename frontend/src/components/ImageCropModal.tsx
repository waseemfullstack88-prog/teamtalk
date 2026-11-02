import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ZoomIn, ZoomOut, RotateCw, Check, ArrowLeft, X } from 'lucide-react';

interface ImageCropModalProps {
  isOpen: boolean;
  imageSrc: string | null;
  onCancel: () => void;
  onCropComplete: (croppedDataUrl: string) => void;
}

const CROP_BOX_SIZE = 260; // 260x260 circular guide in UI
const OUTPUT_SIZE = 512; // 512x512 crisp HD profile avatar export

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  isOpen,
  imageSrc,
  onCancel,
  onCropComplete,
}) => {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imgNatural, setImgNatural] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const initialTouchDistRef = useRef<number | null>(null);
  const initialTouchZoomRef = useRef<number>(1);

  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (isOpen && imageSrc) {
      setZoom(1);
      setRotation(0);
      setPosition({ x: 0, y: 0 });

      const img = new Image();
      img.onload = () => {
        setImgNatural({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
      };
      img.src = imageSrc;
    }
  }, [isOpen, imageSrc]);

  if (!isOpen || !imageSrc) return null;

  // Fit scale: compute scale so image fits comfortably inside the viewfinder without excessive zoom
  const naturalW = imgNatural.width || 400;
  const naturalH = imgNatural.height || 400;
  const fitScale = Math.min(CROP_BOX_SIZE / naturalW, CROP_BOX_SIZE / naturalH);
  // Default base dimension
  const baseW = naturalW * fitScale;
  const baseH = naturalH * fitScale;

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const getDistance = (t1: React.Touch, t2: React.Touch) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y,
      });
      initialTouchDistRef.current = null;
    } else if (e.touches.length === 2) {
      setIsDragging(false);
      initialTouchDistRef.current = getDistance(e.touches[0], e.touches[1]);
      initialTouchZoomRef.current = zoom;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && isDragging) {
      setPosition({
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y,
      });
    } else if (e.touches.length === 2 && initialTouchDistRef.current) {
      const currentDist = getDistance(e.touches[0], e.touches[1]);
      const factor = currentDist / initialTouchDistRef.current;
      const nextZoom = Math.min(3.5, Math.max(0.4, initialTouchZoomRef.current * factor));
      setZoom(nextZoom);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    initialTouchDistRef.current = null;
  };

  const handleDone = () => {
    if (!imageRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background fill
    ctx.fillStyle = '#0b141a';
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    const ratio = OUTPUT_SIZE / CROP_BOX_SIZE;
    const drawW = baseW * zoom * ratio;
    const drawH = baseH * zoom * ratio;

    ctx.save();
    ctx.translate(OUTPUT_SIZE / 2 + position.x * ratio, OUTPUT_SIZE / 2 + position.y * ratio);
    ctx.rotate((rotation * Math.PI) / 180);

    ctx.drawImage(imageRef.current, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.90);
    onCropComplete(croppedDataUrl);
  };

  const content = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: '#0b141a',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {/* Top Header Bar */}
      <div
        style={{
          height: 'calc(54px + var(--safe-top, 0px))',
          paddingTop: 'var(--safe-top, 0px)',
          paddingLeft: 16,
          paddingRight: 16,
          background: '#111b21',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          boxSizing: 'border-box',
          color: '#e9edef',
          flexShrink: 0,
        }}
      >
        <button
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#00a884',
            cursor: 'pointer',
            padding: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <ArrowLeft size={20} />
          <span>Back</span>
        </button>

        <span style={{ fontSize: 16, fontWeight: 700, color: '#e9edef' }}>
          Adjust Profile Photo
        </span>

        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#8696a0',
            cursor: 'pointer',
            padding: 6,
            display: 'flex',
            alignItems: 'center',
          }}
          title="Cancel"
        >
          <X size={22} />
        </button>
      </div>

      {/* Main Viewport */}
      <div
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          flex: 1,
          width: '100%',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: isDragging ? 'grabbing' : 'grab',
          background: '#070a0c',
        }}
      >
        {/* Movable & Scalable Image */}
        <div
          style={{
            position: 'absolute',
            width: baseW * zoom,
            height: baseH * zoom,
            transform: `translate(${position.x}px, ${position.y}px) rotate(${rotation}deg)`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.05s ease-out',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <img
            ref={imageRef}
            src={imageSrc}
            alt="Crop preview"
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
            }}
          />
        </div>

        {/* WhatsApp Circular Guide Overlay Mask (Native SVG Cutout Mask - 100% bug free on Android) */}
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <defs>
            <mask id="cropHoleMask">
              <rect width="100%" height="100%" fill="white" />
              <circle cx="50%" cy="50%" r={CROP_BOX_SIZE / 2} fill="black" />
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(11, 20, 26, 0.85)"
            mask="url(#cropHoleMask)"
          />
          <circle
            cx="50%"
            cy="50%"
            r={CROP_BOX_SIZE / 2}
            fill="none"
            stroke="#00a884"
            strokeWidth="2.5"
          />
        </svg>

        {/* Drag Hint */}
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            fontSize: 12,
            color: 'rgba(233, 237, 239, 0.85)',
            pointerEvents: 'none',
            zIndex: 11,
            background: 'rgba(0, 0, 0, 0.6)',
            padding: '4px 14px',
            borderRadius: 16,
          }}
        >
          Pinch or drag to adjust photo inside circle
        </div>
      </div>

      {/* Bottom Controls Bar */}
      <div
        style={{
          padding: '16px 20px calc(16px + var(--safe-bottom, 0px))',
          background: '#111b21',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          boxSizing: 'border-box',
          flexShrink: 0,
        }}
      >
        {/* Zoom Slider & Rotate Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => setZoom((prev) => Math.max(0.4, prev - 0.1))}
            style={{ background: 'transparent', border: 'none', color: '#8696a0', padding: 4, cursor: 'pointer' }}
          >
            <ZoomOut size={18} />
          </button>
          <input
            type="range"
            min="0.4"
            max="3.5"
            step="0.05"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            style={{
              flex: 1,
              accentColor: '#00a884',
              cursor: 'pointer',
              height: 4,
            }}
          />
          <button
            onClick={() => setZoom((prev) => Math.min(3.5, prev + 0.1))}
            style={{ background: 'transparent', border: 'none', color: '#8696a0', padding: 4, cursor: 'pointer' }}
          >
            <ZoomIn size={18} />
          </button>

          <button
            type="button"
            onClick={() => setRotation((prev) => (prev + 90) % 360)}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              color: '#e9edef',
              borderRadius: 8,
              padding: '6px 12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              flexShrink: 0,
            }}
            title="Rotate 90° clockwise"
          >
            <RotateCw size={14} />
            <span>Rotate</span>
          </button>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1,
              padding: '12px 18px',
              borderRadius: 24,
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              color: '#e9edef',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDone}
            style={{
              flex: 2,
              padding: '12px 24px',
              borderRadius: 24,
              background: '#00a884',
              border: 'none',
              color: '#ffffff',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 2px 10px rgba(0, 168, 132, 0.45)',
            }}
          >
            <Check size={18} />
            Save Profile Photo
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
};
