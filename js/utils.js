export function generateId() {
  return crypto.randomUUID();
}

export function shuffleArray(arr) {
  const newArr = [...arr];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

export function fuzzyMatch(str1, str2) {
  if (!str1 || !str2) return false;
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) return true;
  if (s1.includes(s2) || s2.includes(s1)) return true;

  const distance = (a, b) => {
    const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        matrix[i][j] = a[i - 1] === b[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]) + 1;
      }
    }
    return matrix[a.length][b.length];
  };

  return distance(s1, s2) <= 2;
}

export function getWeightedRandomPlayer(pool, difficulty) {
  if (!pool || pool.length === 0) return null;
  if (difficulty === 'hard') return randomFromArray(pool);

  const getFame = (p) => {
    let score = 0;
    if (p.marketValue) score += parseInt(p.marketValue) * 0.1;
    if (p.caps) score += p.caps * 0.5;
    if (p.trophies) score += p.trophies.length * 2;
    return score;
  };

  const weightedPool = pool.map(p => ({ player: p, weight: getFame(p) + 1 }));
  const totalWeight = weightedPool.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;

  for (const item of weightedPool) {
    random -= item.weight;
    if (random <= 0) return item.player;
  }
  return randomFromArray(pool);
}

export function getAge(dateOfBirth) {
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

export function getAgeRange(dateOfBirth) {
  const age = getAge(dateOfBirth);
  if (age < 20) return "Under 20";
  if (age >= 20 && age < 25) return "20-25";
  if (age >= 25 && age < 30) return "25-30";
  if (age >= 30 && age < 35) return "30-35";
  if (age >= 35 && age < 40) return "35-40";
  return "40+";
}

const flagMap = {
  "Argentina": "🇦🇷", "Brazil": "🇧🇷", "France": "🇫🇷", "Germany": "🇩🇪", "Spain": "🇪🇸",
  "England": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "Portugal": "🇵🇹", "Netherlands": "🇳🇱", "Belgium": "🇧🇪", "Croatia": "🇭🇷",
  "Italy": "🇮🇹", "Uruguay": "🇺🇾", "Colombia": "🇨🇴", "Chile": "🇨🇱", "Mexico": "🇲🇽",
  "USA": "🇺🇸", "Senegal": "🇸🇳", "Morocco": "🇲🇦", "Japan": "🇯🇵", "South Korea": "🇰🇷",
  "Switzerland": "🇨🇭", "Denmark": "🇩🇰", "Sweden": "🇸🇪", "Poland": "🇵🇱", "Serbia": "🇷🇸",
  "Wales": "🏴󠁧󠁢󠁷󠁬󠁳󠁿", "Scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "Norway": "🇳🇴", "Ivory Coast": "🇨🇮", "Nigeria": "🇳🇬",
  "Ghana": "🇬🇭", "Cameroon": "🇨🇲", "Egypt": "🇪🇬", "Algeria": "🇩🇿", "Tunisia": "🇹🇳",
  "Ecuador": "🇪🇨", "Peru": "🇵🇪", "Paraguay": "🇵🇾", "Venezuela": "🇻🇪", "Bolivia": "🇧🇴",
  "Canada": "🇨🇦", "Costa Rica": "🇨🇷", "Australia": "🇦🇺", "Iran": "🇮🇷", "Saudi Arabia": "🇸🇦",
  "Turkey": "🇹🇷", "Greece": "🇬🇷", "Czech Republic": "🇨🇿", "Austria": "🇦🇹", "Hungary": "🇭🇺",
  "Ukraine": "🇺🇦", "Republic of Ireland": "🇮🇪", "Northern Ireland": "🇬🇧",
  "Finland": "🇫🇮"
};

export function getFlag(nationality) {
  return nationality; // Now just returns the name, as icons are handled by ICON_MAP
}

export function debounce(fn, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

export function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function randomFromArray(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function createConfetti(container) {
  container = container || document.body;
  const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4CAF50', '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800', '#FF5722'];

  for (let i = 0; i < 50; i++) {
    const confetti = document.createElement('div');
    confetti.style.position = 'fixed';
    confetti.style.width = `${Math.random() * 10 + 5}px`;
    confetti.style.height = `${Math.random() * 5 + 5}px`;
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];

    const startX = Math.random() * 100;
    const startY = -10;
    confetti.style.left = `${startX}%`;
    confetti.style.top = `${startY}%`;
    confetti.style.opacity = '1';
    confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
    confetti.style.pointerEvents = 'none';
    confetti.style.zIndex = '1000';
    confetti.style.transition = 'top 2s ease-in, left 2s ease-out, opacity 2s ease-in, transform 2s linear';

    container.appendChild(confetti);

    setTimeout(() => {
      const endY = 100 + Math.random() * 20;
      const endX = startX + (Math.random() * 40 - 20);
      confetti.style.top = `${endY}%`;
      confetti.style.left = `${endX}%`;
      confetti.style.opacity = '0';
      confetti.style.transform = `rotate(${Math.random() * 720}deg)`;
    }, 10);

    setTimeout(() => {
      if (confetti.parentNode === container) {
        container.removeChild(confetti);
      }
    }, 2000);
  }
}

export const GameEffects = {
    shake(element) {
        element.classList.add('screen-shake');
        setTimeout(() => element.classList.remove('screen-shake'), 500);
    },

    flash(colorClass) {
        const aura = document.querySelector('.bg-aura');
        if (aura) {
            aura.classList.add(colorClass);
            setTimeout(() => aura.classList.remove(colorClass), 1000);
        }
    },

    tickValue(element, start, end, duration = 1000) {
        let current = start;
        const step = (end - start) / (duration / 16);
        const timer = setInterval(() => {
            current += step;
            if ((step > 0 && current >= end) || (step < 0 && current <= end)) {
                element.textContent = end;
                clearInterval(timer);
            } else {
                element.textContent = Math.floor(current);
            }
        }, 16);
    },

    async revealSequence(element) {
        // 1. Flash
        element.classList.add('reveal-flash');
        await new Promise(r => setTimeout(r, 150));
        element.classList.remove('reveal-flash');

        // 2. Scale
        element.style.transform = 'scale(1.1)';
        await new Promise(r => setTimeout(r, 100));

        // 3. Flip
        element.classList.add('revealed');
        await new Promise(r => setTimeout(r, 600));

        // 4. Settle
        element.style.transform = '';
    }
};
