// 回到顶部：滚过一屏才有用，所以滚过一屏才出现。
const btn = document.getElementById('to-top');
if (btn) {
  const sync = () => {
    btn.hidden = window.scrollY < window.innerHeight;
  };
  addEventListener('scroll', sync, { passive: true });
  sync();
  btn.addEventListener('click', () => {
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  });
}
