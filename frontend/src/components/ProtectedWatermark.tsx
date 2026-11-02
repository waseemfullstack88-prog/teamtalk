import React from 'react';

interface Props {
  text?: string;
  userEmail?: string;
  userDisplayName?: string;
}

export const ProtectedWatermark: React.FC<Props> = ({ text, userEmail, userDisplayName }) => {
  const content =
    text ||
    (userEmail
      ? `${userDisplayName || userEmail} • TeamTalk Protected • ${new Date().toLocaleDateString()}`
      : 'TeamTalk Protected Space');

  // Render a 3x5 subtle matrix of rotated watermark stamps
  const stamps = Array.from({ length: 15 });

  return (
    <div className="security-watermark-overlay" aria-hidden="true">
      {stamps.map((_, i) => (
        <div key={i} className="watermark-text">
          {content}
        </div>
      ))}
    </div>
  );
};
