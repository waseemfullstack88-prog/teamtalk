import React, { useState, useMemo, useEffect } from 'react';
import { Search, Clock, Smile, User, Heart, Dog, Utensils, Trophy, Plane, Lightbulb, Delete, X } from 'lucide-react';

interface EmojiPickerProps {
  onSelectEmoji: (emoji: string) => void;
  onBackspace?: () => void;
  onClose: () => void;
  inline?: boolean;
}

interface EmojiCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  emojis: string[];
}

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    name: 'Smileys & Emotion',
    icon: <Smile size={18} />,
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇',
      '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗',
      '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
      '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶',
      '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯',
      '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣',
      '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️',
      '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖'
    ],
  },
  {
    id: 'people',
    name: 'People & Body',
    icon: <User size={18} />,
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙',
      '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏',
      '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶',
      '👂', '🦻', '👃', '🫀', '🫁', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋',
      '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '👩', '🧓', '👴', '👵', '🙍',
      '🙎', '🙅', '🙆', '💁', '🙋', '🧏', '🙇', '🤦', '🤷', '👮', '🕵️', '💂', '👷'
    ],
  },
  {
    id: 'hearts',
    name: 'Hearts & Love',
    icon: <Heart size={18} />,
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞',
      '💓', '💗', '💖', '💘', '💝', '💟', '💌', '❤️‍🔥', '❤️‍🩹', '💋', '💍', '💎'
    ],
  },
  {
    id: 'animals',
    name: 'Animals & Nature',
    icon: <Dog size={18} />,
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷',
      '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆',
      '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞',
      '🐜', '🪰', '🪲', '🪳', '🪴', '🌲', '🌳', '🌴', '🌵', '🌾', '🌿', '☘️', '🍀',
      '🍁', '🍂', '🍃', '🍄', '🌸', '🌺', '🌹', '🌷', '🌻', '🌼', '🌞', '🌝', '⭐',
      '🌟', '✨', '⚡', '☄️', '💥', '🔥', '🌈', '☀️', '🌤️', '⛅', '🌧️', '⛈️', '❄️'
    ],
  },
  {
    id: 'food',
    name: 'Food & Drink',
    icon: <Utensils size={18} />,
    emojis: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑',
      '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🌽', '🥕',
      '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩',
      '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🥪', '🥙', '🌮', '🌯', '🥗', '🥘', '🥫',
      '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🍤', '🍙', '🍨', '🍧', '🍦', '🍩',
      '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭', '☕', '🍵', '🧃', '🥤', '🍺', '🍻', '🍷'
    ],
  },
  {
    id: 'activities',
    name: 'Activities & Sports',
    icon: <Trophy size={18} />,
    emojis: [
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸',
      '🏒', '🏑', '🏏', '⛳', '🏹', '🎣', '🤿', '🥊', '🥋', '🛹', '🛼', '⛷️', '🏂',
      '🏋️', '🤼', '🤸', '⛹️', '🧗', '🏄', '🏊', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅',
      '🎫', '🎪', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🎮', '🎲'
    ],
  },
  {
    id: 'travel',
    name: 'Travel & Places',
    icon: <Plane size={18} />,
    emojis: [
      '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛',
      '🛴', '🚲', '🛵', '🏍️', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚂', '🚆', '🚇',
      '✈️', '🛫', '🛬', '🪂', '🛰️', '🚀', '🛸', '🛶', '⛵', '🚤', '🛳️', '⚓', '⛽',
      '🗽', '🗼', '🏰', '🏟️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️'
    ],
  },
  {
    id: 'objects',
    name: 'Objects & Symbols',
    icon: <Lightbulb size={18} />,
    emojis: [
      '💡', '🔦', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '📷', '📸', '📹', '🎥',
      '📞', '☎️', '📟', '📺', '📻', '🎙️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🔌',
      '💵', '💰', '💳', '💎', '⚖️', '🧰', '🔧', '🔨', '⚙️', '🔑', '🗝️', '🔒', '🔓',
      '✉️', '📩', '📨', '📧', '📦', '🏷️', '📝', '📅', '📆', '📋', '📁', '📂', '📌',
      '📍', '📎', '✂️', '🔍', '🔎', '🔔', '🔕', '💬', '💭', '💯', '⚠️', '✅', '❌',
      '⛔', '🚫', '🟢', '🟡', '🔴', '🟣', '🟠', '🟦', '🏁', '🚩', '🎌'
    ],
  },
];

const SEARCH_MAP: Record<string, string[]> = {
  heart: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖'],
  love: ['❤️', '🥰', '😍', '😘', '💕', '💖', '💌', '💑', '👩‍❤️‍👨'],
  happy: ['😀', '😃', '😄', '😁', '😆', '😅', '😊', '😇', '🥰', '😍'],
  smile: ['😀', '😃', '😄', '😁', '🙂', '🙃', '😉', '😊'],
  laugh: ['😂', '🤣', '😆', '😹'],
  cry: ['😢', '😭', '😿', '🥺', '😓'],
  sad: ['😔', '🙁', '☹️', '😢', '😭', '😞', '😓'],
  fire: ['🔥', '❤️‍🔥', '⚡', '💥', '🧨'],
  thumb: ['👍', '👎'],
  ok: ['👌', '👍', '✅', '🙆'],
  clap: ['👏', '🙌'],
  pray: ['🙏', '🤲'],
  cool: ['😎', '🕶️', '🥶', '🧊'],
  cat: ['🐱', '🐈', '😸', '😹', '😻'],
  dog: ['🐶', '🐕', '🦮'],
  car: ['🚗', '🚕', '🚙', '🏎️', '🚘'],
  coffee: ['☕', '🍵', '🧋'],
  beer: ['🍺', '🍻', '🥂', '🍾'],
  party: ['🥳', '🎉', '🎊', '🎈', '🍾'],
  star: ['⭐', '🌟', '✨', '💫', '🤩'],
  check: ['✅', '✔️', '☑️'],
  cross: ['❌', '❎'],
  money: ['💵', '💰', '💳', '🤑', '💎'],
  phone: ['📱', '📲', '📞', '☎️'],
  music: ['🎵', '🎶', '🎤', '🎧', '🎸', '🎹'],
};

export const EmojiPicker: React.FC<EmojiPickerProps> = ({
  onSelectEmoji,
  onBackspace,
  onClose,
  inline = false,
}) => {
  const [activeTab, setActiveTab] = useState<string>('smileys');
  const [searchQuery, setSearchQuery] = useState('');
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);

  // Load recents on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tt_recent_emojis');
      if (saved) {
        setRecentEmojis(JSON.parse(saved).slice(0, 24));
      } else {
        setRecentEmojis(['👍', '❤️', '😂', '🔥', '🎉', '🙏', '😊', '😍', '👏', '✨', '👀', '💯']);
      }
    } catch {
      setRecentEmojis(['👍', '❤️', '😂', '🔥', '🎉', '🙏', '😊', '😍']);
    }
  }, []);

  const handleEmojiClick = (emoji: string) => {
    onSelectEmoji(emoji);
    // Add to recents
    const updated = [emoji, ...recentEmojis.filter((e) => e !== emoji)].slice(0, 24);
    setRecentEmojis(updated);
    try {
      localStorage.setItem('tt_recent_emojis', JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  // Filter emojis based on search
  const filteredEmojis = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;

    const matchedSet = new Set<string>();
    // Direct search map check
    for (const [key, list] of Object.entries(SEARCH_MAP)) {
      if (key.includes(q)) {
        list.forEach((em) => matchedSet.add(em));
      }
    }

    // Category name check
    EMOJI_CATEGORIES.forEach((cat) => {
      if (cat.name.toLowerCase().includes(q)) {
        cat.emojis.slice(0, 20).forEach((em) => matchedSet.add(em));
      }
    });

    return Array.from(matchedSet);
  }, [searchQuery]);

  const currentCategory = EMOJI_CATEGORIES.find((c) => c.id === activeTab) || EMOJI_CATEGORIES[0];

  return (
    <div
      className="emoji-picker-container"
      style={{
        position: inline ? 'relative' : 'absolute',
        bottom: inline ? 0 : 58,
        left: 0,
        right: 0,
        maxWidth: inline ? '100%' : 390,
        height: 310,
        background: '#202c33',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: inline ? '16px 16px 0 0' : 16,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
        overflow: 'hidden',
        animation: 'slideUp 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top Search & Action Bar */}
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: '#111b21',
        }}
      >
        <div
          style={{
            position: 'relative',
            flex: 1,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Search size={15} color="#8696a0" style={{ position: 'absolute', left: 10 }} />
          <input
            type="text"
            placeholder="Search emoji..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              height: 34,
              paddingLeft: 32,
              paddingRight: 28,
              background: '#202c33',
              border: 'none',
              borderRadius: 8,
              color: '#e9edef',
              fontSize: 13,
              outline: 'none',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: 8,
                background: 'none',
                border: 'none',
                color: '#8696a0',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: 0,
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {onBackspace && (
          <button
            onClick={onBackspace}
            title="Delete"
            style={{
              background: 'none',
              border: 'none',
              color: '#8696a0',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 34,
              height: 34,
              borderRadius: 8,
            }}
          >
            <Delete size={18} />
          </button>
        )}

        <button
          onClick={onClose}
          title="Close emoji picker"
          style={{
            background: 'none',
            border: 'none',
            color: '#8696a0',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            borderRadius: 8,
          }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Main Emoji Grid Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 10px',
        }}
      >
        {searchQuery ? (
          <div>
            <div style={{ fontSize: 11, color: '#8696a0', fontWeight: 600, margin: '4px 6px 8px' }}>
              SEARCH RESULTS ({filteredEmojis?.length || 0})
            </div>
            {filteredEmojis && filteredEmojis.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
                {filteredEmojis.map((em, idx) => (
                  <button
                    key={`${em}-${idx}`}
                    onClick={() => handleEmojiClick(em)}
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: 24,
                      padding: '6px 0',
                      borderRadius: 8,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'transform 0.1s ease',
                    }}
                    className="emoji-btn"
                  >
                    {em}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#8696a0', fontSize: 13 }}>
                No emojis found matching "{searchQuery}"
              </div>
            )}
          </div>
        ) : (
          <div>
            {/* Recents Section */}
            {recentEmojis.length > 0 && activeTab === 'recent' && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#8696a0', fontWeight: 600, margin: '4px 6px 8px' }}>
                  RECENTLY USED
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
                  {recentEmojis.map((em, idx) => (
                    <button
                      key={`recent-${em}-${idx}`}
                      onClick={() => handleEmojiClick(em)}
                      style={{
                        background: 'none',
                        border: 'none',
                        fontSize: 24,
                        padding: '6px 0',
                        borderRadius: 8,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      className="emoji-btn"
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Current Category Emojis */}
            {activeTab !== 'recent' && (
              <div>
                <div style={{ fontSize: 11, color: '#8696a0', fontWeight: 600, margin: '4px 6px 8px' }}>
                  {currentCategory.name.toUpperCase()}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
                  {currentCategory.emojis.map((em, idx) => (
                    <button
                      key={`${currentCategory.id}-${idx}`}
                      onClick={() => handleEmojiClick(em)}
                      style={{
                        background: 'none',
                        border: 'none',
                        fontSize: 24,
                        padding: '6px 0',
                        borderRadius: 8,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      className="emoji-btn"
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Category Selector Bar (Authentic WhatsApp Tab Strip) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          height: 44,
          background: '#111b21',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '0 4px',
        }}
      >
        <button
          onClick={() => {
            setActiveTab('recent');
            setSearchQuery('');
          }}
          title="Recent Emojis"
          style={{
            background: 'none',
            border: 'none',
            color: activeTab === 'recent' ? '#00a884' : '#8696a0',
            cursor: 'pointer',
            padding: 8,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          <Clock size={19} />
          {activeTab === 'recent' && (
            <span
              style={{
                position: 'absolute',
                bottom: 2,
                left: '25%',
                right: '25%',
                height: 2,
                background: '#00a884',
                borderRadius: 2,
              }}
            />
          )}
        </button>

        {EMOJI_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => {
              setActiveTab(cat.id);
              setSearchQuery('');
            }}
            title={cat.name}
            style={{
              background: 'none',
              border: 'none',
              color: activeTab === cat.id ? '#00a884' : '#8696a0',
              cursor: 'pointer',
              padding: 8,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            {cat.icon}
            {activeTab === cat.id && (
              <span
                style={{
                  position: 'absolute',
                  bottom: 2,
                  left: '25%',
                  right: '25%',
                  height: 2,
                  background: '#00a884',
                  borderRadius: 2,
                }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

