import React from 'react';
import { Card, Suit, Rank } from '../types';
import { getSuitColor } from '../constants';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  small?: boolean;
  isLaizi?: boolean;
}

const CardComponent: React.FC<CardProps> = ({ card, onClick, selected, small, isLaizi, ...props }) => {
  const defaultColor = getSuitColor(card.suit);
  
  const isSmallJoker = card.rank === Rank.SmallJoker;
  const isBigJoker = card.rank === Rank.BigJoker;
  const isJoker = isSmallJoker || isBigJoker;

  // Specific colors and styles
  let colorClass = defaultColor;
  let jokerLabel = '';
  
  if (isSmallJoker) {
      colorClass = 'text-slate-600';
      jokerLabel = '小王';
  }
  if (isBigJoker) {
      colorClass = 'text-red-600';
      jokerLabel = '大王';
  }

  const renderLabel = () => {
    if (isJoker) {
      return (
        <div className="flex flex-col items-center justify-center leading-none py-1 writing-vertical-rl text-[0.6em] md:text-xs h-full gap-0.5 font-black tracking-tighter">
            {jokerLabel.split('').map((char, i) => <span key={i}>{char}</span>)}
        </div>
      );
    }
    return (
      <>
        <div>{card.label}</div>
        <div className="text-sm">{card.suit}</div>
      </>
    );
  };

  return (
    <div
      onClick={onClick}
      {...props}
      className={`
        relative bg-white rounded-lg border card-shadow select-none
        flex flex-col items-center justify-between
        transition-all duration-200 ease-out
        ${small ? 'w-10 h-14 text-[10px]' : 'w-24 h-36 text-xl'}
        ${selected ? '-translate-y-8 ring-4 ring-yellow-400 shadow-2xl z-20 scale-105' : 'hover:-translate-y-2 hover:shadow-lg z-0'}
        ${isLaizi ? 'border-yellow-400 bg-yellow-50/50' : 'border-gray-300'}
        cursor-pointer overflow-hidden
        ${props.className || ''}
      `}
      style={{ 
        marginLeft: small ? '-1.5rem' : '-2.5rem', 
        touchAction: 'none',
        ...props.style 
      }} 
    >
      {/* Laizi Indicator */}
      {isLaizi && !small && (
        <div className="absolute -top-3 -right-3 w-8 h-8 z-30 bg-gradient-to-br from-yellow-300 to-yellow-500 rounded-full flex items-center justify-center shadow-md text-xs font-bold text-red-900 border border-white">
          癞
        </div>
      )}

      {/* Top Left Value */}
      <div className={`absolute top-1 left-1 font-bold flex flex-col items-center ${colorClass}`}>
        {renderLabel()}
      </div>

      {/* Center Suit / Image */}
      <div className={`flex-1 flex items-center justify-center text-5xl ${colorClass} opacity-90`}>
        {isJoker ? (
           <span className={`${isSmallJoker ? 'grayscale opacity-70' : 'drop-shadow-md'}`}>🤡</span>
        ) : (
           <span className="drop-shadow-sm">{card.suit}</span>
        )}
      </div>

      {/* Bottom Right Inverted */}
      <div className={`absolute bottom-1 right-1 font-bold flex flex-col items-center ${colorClass} rotate-180`}>
        {renderLabel()}
      </div>
    </div>
  );
};

export default CardComponent;