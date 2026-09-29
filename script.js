const menu = document.querySelector('.menu');
const mobile = document.querySelector('.mobile-nav');

if (menu && mobile) {
  menu.addEventListener('click', () => {
    const open = mobile.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
    mobile.setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('menu-open', open);
  });

  mobile.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    mobile.classList.remove('open');
    menu.setAttribute('aria-expanded', 'false');
    mobile.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('menu-open');
  }));
}

document.querySelectorAll('.faq-item button').forEach(button => {
  button.addEventListener('click', () => {
    const item = button.closest('.faq-item');
    const alreadyOpen = item.classList.contains('open');

    document.querySelectorAll('.faq-item').forEach(entry => {
      entry.classList.remove('open');
      const trigger = entry.querySelector('button');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.querySelector('i').textContent = '+';
    });

    if (!alreadyOpen) {
      item.classList.add('open');
      button.setAttribute('aria-expanded', 'true');
      button.querySelector('i').textContent = '−';
    }
  });
});

const billingButtons = document.querySelectorAll('.billing button');
const amount = document.querySelector('.amount strong');
const unit = document.querySelector('.amount small');

billingButtons.forEach(button => {
  button.addEventListener('click', () => {
    billingButtons.forEach(entry => entry.classList.remove('active'));
    button.classList.add('active');

    const mode = button.dataset.mode;
    amount.textContent = amount.dataset[mode];
    unit.textContent = unit.dataset[mode];
  });
});

const root = document.documentElement;
const demoBadge = document.querySelector('.demo-badge');
const swatches = document.querySelectorAll('.swatch');

swatches.forEach(swatch => {
  swatch.addEventListener('click', () => {
    swatches.forEach(entry => entry.classList.remove('active'));
    swatch.classList.add('active');

    const color = swatch.dataset.color;
    root.style.setProperty('--club', color);
    demoBadge.style.background = color;
  });
});
