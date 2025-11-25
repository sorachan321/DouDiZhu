import React from 'react';
import { Card, Suit } from '../types';
import { getSuitColor } from '../constants';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  small?: boolean;
  isLaizi?: boolean;
}

const CardComponent: React.FC<CardProps> = ({ card, onClick, selected, small, isLaizi, ...props }) => {
  const colorClass = getSuitColor(card.suit);
  
  return (
    <div
      onClick={onClick}
      {...props}
      className={`
        relative bg-white rounded-lg border card-shadow select-none
        flex flex-col items-center justify-between
        transition-transform duration-100 ease-out
        ${small ? 'w-10 h-14 text-xs' : 'w-24 h-36 text-xl'}
        ${selected ? '-translate-y-6 ring-2 ring-blue-400 shadow-xl z-10' : 'hover:-translate-y-2 z-0'}
        ${isLaizi ? 'border-yellow-400 ring-2 ring-yellow-400 bg-yellow-50' : 'border-gray-300'}
        cursor-pointer
        ${props.className || ''}
      `}
      style={{ 
        marginLeft: small ? '-1.5rem' : '-2rem', 
        touchAction: 'none', // Critical for swipe selection
        ...props.style 
      }} 
    >
      {/* Laizi Indicator */}
      {isLaizi && !small && (
        <div className="absolute -top-3 -right-3 w-8 h-8 z-20 bg-gradient-to-br from-yellow-300 to-yellow-500 rounded-full flex items-center justify-center shadow-md text-xs font-bold text-red-800 animate-bounce">
          癞
        </div>
      )}

      {/* Top Left Value */}
      <div className={`absolute top-1 left-1 font-bold ${colorClass}`}>
        <div>{card.label}</div>
        <div className="text-sm">{card.suit}</div>
      </div>

      {/* Center Big Suit */}
      <div className={`text-4xl ${colorClass} opacity-20`}>
        {card.suit === Suit.None ? '🤡' : card.suit}
      </div>

      {/* Bottom Right Inverted */}
      <div className={`absolute bottom-1 right-1 font-bold ${colorClass} rotate-180`}>
        <div>{card.label}</div>
        <div className="text-sm">{card.suit}</div>
      </div>
    </div>
  );
};

export default CardComponent;