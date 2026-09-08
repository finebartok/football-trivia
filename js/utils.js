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
  "Ukraine": "🇺🇦", "Republic of Ireland": "🇮🇪", "Northern Ireland": "🇬🇧", "Finland": "🇫🇮"
};

export function getFlag(nationality) {
  return flagMap[nationality] || "🏳️";
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
    .replace(/"/g, "&quot;")
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
    confetti.style.position = 'absolute';
    confetti.style.width = `${Math.random() * 10 + 5}px`;
    confetti.style.height = `${Math.random() * 5 + 5}px`;
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    
    // Initial position
    const startX = Math.random() * 100;
    const startY = -10; // Start slightly above container
    confetti.style.left = `${startX}%`;
    confetti.style.top = `${startY}%`;
    confetti.style.opacity = '1';
    confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
    confetti.style.pointerEvents = 'none';
    confetti.style.zIndex = '1000';
    confetti.style.transition = 'top 2s ease-in, left 2s ease-out, opacity 2s ease-in, transform 2s linear';
    
    container.appendChild(confetti);
    
    // Trigger animation
    setTimeout(() => {
      const endY = 100 + Math.random() * 20;
      const endX = startX + (Math.random() * 40 - 20); // Drift left or right
      confetti.style.top = `${endY}%`;
      confetti.style.left = `${endX}%`;
      confetti.style.opacity = '0';
      confetti.style.transform = `rotate(${Math.random() * 720}deg)`;
    }, 10);
    
    // Cleanup
    setTimeout(() => {
      if (confetti.parentNode === container) {
        container.removeChild(confetti);
      }
    }, 2000);
  }
}
