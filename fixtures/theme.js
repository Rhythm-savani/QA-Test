/* Dawn-like behaviour for the fixture sites. Plain JS, no dependencies. */
(function () {
  var qs = function (s, r) {
    return (r || document).querySelector(s);
  };
  var qsa = function (s, r) {
    return Array.prototype.slice.call((r || document).querySelectorAll(s));
  };
  var broken = document.documentElement.getAttribute('data-site') === 'broken';

  function fmt(cents) {
    return '$' + (cents / 100).toFixed(2);
  }

  async function cart() {
    return (await fetch('/cart.js', { headers: { Accept: 'application/json' } })).json();
  }

  function updateBadge(count) {
    var icon = qs('#cart-icon-bubble');
    if (!icon) return;
    var b = qs('.cart-count-bubble', icon);
    if (count > 0) {
      if (!b) {
        b = document.createElement('div');
        b.className = 'cart-count-bubble';
        b.innerHTML = '<span aria-hidden="true"></span><span class="visually-hidden"></span>';
        icon.appendChild(b);
      }
      qs('span[aria-hidden]', b).textContent = String(count);
      qs('.visually-hidden', b).textContent = count + ' items';
    } else if (b) b.remove();
  }

  class CartDrawer extends HTMLElement {
    connectedCallback() {
      var self = this;
      this.addEventListener('click', function (e) {
        if (e.target === self || e.target.classList.contains('cart-drawer__overlay')) self.close();
      });
      qsa('.drawer__close', this).forEach(function (b) {
        b.addEventListener('click', function () {
          if (!self.dataset.noclose) self.close();
        });
      });
      this.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !self.dataset.noescape) self.close();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self.classList.contains('active') && !self.dataset.noescape)
          self.close();
      });
    }
    open(opener) {
      this.opener = opener || document.activeElement;
      this.classList.add('active');
      document.body.classList.add('overflow-hidden');
      var inner = qs('.drawer__inner', this);
      if (inner) inner.focus();
    }
    close() {
      this.classList.remove('active');
      if (!this.dataset.keeplock) document.body.classList.remove('overflow-hidden');
      if (this.opener && this.opener.focus) this.opener.focus();
    }
    async render() {
      var c = await cart();
      var list = qs('#CartDrawer-Items', this);
      if (list) {
        list.textContent = '';
        c.items.forEach(function (i) {
          var li = document.createElement('li');
          li.textContent = i.title + ' × ' + i.quantity + ' — ' + fmt(i.line_price);
          list.appendChild(li);
        });
        if (!c.items.length) list.textContent = 'Your cart is empty';
      }
      var t = qs('#CartDrawer-Total', this);
      if (t) t.textContent = fmt(c.total_price);
    }
  }
  customElements.define('cart-drawer', CartDrawer);

  class DetailsModal extends HTMLElement {
    connectedCallback() {
      var self = this;
      this.details = qs('details', this);
      this.summary = qs('summary', this);
      if (!this.details) return;
      this.summary.addEventListener('click', function () {
        setTimeout(function () {
          self.summary.setAttribute('aria-expanded', String(self.details.open));
          if (self.details.open) {
            var i = qs('input[type=search]', self);
            if (i) i.focus();
          }
        });
      });
      this.addEventListener('keyup', function (e) {
        if (e.key === 'Escape' && !self.dataset.noescape) self.close();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self.details.open && !self.dataset.noescape) self.close();
      });
      qsa('.modal__close-button', this).forEach(function (b) {
        b.addEventListener('click', function () {
          if (!self.dataset.noclose) self.close();
        });
      });
      document.addEventListener('click', function (e) {
        if (self.details.open && !self.contains(e.target)) self.close(false);
      });
      this.summary.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') self.close();
      });
    }
    close(focus) {
      this.details.removeAttribute('open');
      this.summary.setAttribute('aria-expanded', 'false');
      if (focus !== false) this.summary.focus();
    }
  }
  customElements.define('details-modal', DetailsModal);

  class HeaderDrawer extends HTMLElement {
    connectedCallback() {
      var self = this;
      this.details = qs('details', this);
      this.summary = qs('summary', this);
      this.summary.addEventListener('click', function () {
        setTimeout(function () {
          self.summary.setAttribute('aria-expanded', String(self.details.open));
        });
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && self.details.open) {
          self.details.removeAttribute('open');
          self.summary.setAttribute('aria-expanded', 'false');
          self.summary.focus();
        }
      });
      qsa('.menu-drawer__close-button', this).forEach(function (b) {
        b.addEventListener('click', function () {
          self.details.removeAttribute('open');
          self.summary.setAttribute('aria-expanded', 'false');
          self.summary.focus();
        });
      });
    }
  }
  customElements.define('header-drawer', HeaderDrawer);

  class SliderComponent extends HTMLElement {
    connectedCallback() {
      var self = this;
      this.list = qs('.slider', this);
      this.prev = qs('.slider-button--prev', this);
      this.next = qs('.slider-button--next', this);
      var step = function () {
        var s = qs('.slider__slide', self.list);
        return s ? s.getBoundingClientRect().width + 12 : 200;
      };
      if (this.next)
        this.next.addEventListener('click', function () {
          if (self.dataset.broken) return;
          self.list.scrollBy({ left: step(), behavior: 'auto' });
        });
      if (this.prev)
        this.prev.addEventListener('click', function () {
          self.list.scrollBy({ left: -step(), behavior: 'auto' });
        });
      var update = function () {
        var max = self.list.scrollWidth - self.list.clientWidth - 1;
        if (self.prev) self.prev.disabled = self.list.scrollLeft <= 0;
        if (self.next) self.next.disabled = self.list.scrollLeft >= max;
      };
      this.list.addEventListener('scroll', update);
      update();
    }
  }
  customElements.define('slider-component', SliderComponent);

  class ProductInfo extends HTMLElement {
    connectedCallback() {
      var self = this;
      var raw = qs('script[data-product-json]', this);
      if (!raw) return;
      this.product = JSON.parse(raw.textContent);
      var form = qs('form', this);
      var add = qs('button[name="add"]', this);
      var priceEl = qs('.price-item--regular', this);
      var img = qs('.product__media img', this);
      function selected() {
        var vals = [];
        qsa('[data-option-index]', self).forEach(function (el) {
          var idx = Number(el.getAttribute('data-option-index'));
          if (el.tagName === 'SELECT') vals[idx] = el.value;
          else if (el.checked) vals[idx] = el.value;
        });
        return vals;
      }
      function apply() {
        var vals = selected();
        var v = self.product.variants.find(function (x) {
          return x.options.every(function (o, i) {
            return o === vals[i];
          });
        });
        if (!v) return;
        qs('input[name="id"]', form).value = String(v.id);
        priceEl.textContent = fmt(v.price);
        if (v.available) {
          add.disabled = false;
          add.textContent = 'Add to cart';
        } else {
          add.disabled = true;
          add.textContent = 'Sold out';
        }
        if (broken && v.forceEnabled) {
          add.disabled = false;
          add.textContent = 'Add to cart';
        }
        var url = new URL(location.href);
        if (!(broken && self.dataset.nourl)) {
          url.searchParams.set('variant', String(v.id));
          history.replaceState(null, '', url);
        }
        if (v.image && img && !(broken && self.dataset.nomedia)) img.src = v.image;
      }
      this.addEventListener('change', function (e) {
        if (e.target.closest('[data-option-index]')) apply();
      });
      var m = new URL(location.href).searchParams.get('variant');
      if (m) {
        var v = this.product.variants.find(function (x) {
          return String(x.id) === m;
        });
        if (v)
          qsa('[data-option-index]', this).forEach(function (el) {
            var idx = Number(el.getAttribute('data-option-index'));
            if (el.tagName === 'SELECT') el.value = v.options[idx];
            else el.checked = el.value === v.options[idx];
          });
      }
      apply();
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (add.disabled) return;
        var id = qs('input[name="id"]', form).value;
        await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: Number(id), quantity: 1 }),
        });
        var c = await cart();
        updateBadge(c.item_count);
        var drawer = qs('cart-drawer');
        if (drawer) {
          await drawer.render();
          drawer.open(add);
        }
      });
    }
  }
  customElements.define('product-info', ProductInfo);

  // cart icon opens the drawer instead of navigating (as Dawn does)
  var icon = qs('#cart-icon-bubble');
  var drawer = qs('cart-drawer');
  if (icon && drawer) {
    icon.addEventListener('click', async function (e) {
      e.preventDefault();
      await drawer.render();
      drawer.open(icon);
    });
  }

  // predictive search
  var search = qs('details-modal.header__search input[type=search]');
  if (search) {
    var panel = qs('#predictive-search-results');
    var timer;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(async function () {
        var q = search.value.trim();
        if (!q) {
          panel.hidden = true;
          return;
        }
        var r = await fetch('/search/suggest?q=' + encodeURIComponent(q));
        var html = await r.text();
        panel.innerHTML = html;
        panel.hidden = false;
      }, 120);
    });
  }

  // tabs
  qsa('.tabs').forEach(function (t) {
    var tabs = qsa('[role=tab]', t);
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (o) {
          var on = o === tab;
          o.setAttribute('aria-selected', String(on));
          var p = document.getElementById(o.getAttribute('aria-controls'));
          if (p) p.hidden = !on;
        });
      });
    });
  });

  // seeded broken behaviours (only wired when the markup asks for them)
  qsa('[data-qa-modal-open]').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = document.getElementById(b.getAttribute('data-qa-modal-open'));
      m.classList.add('is-open');
      if (m.dataset.lock) document.body.classList.add('overflow-hidden');
    });
  });
  qsa('[data-qa-modal-close]').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = document.getElementById(b.getAttribute('data-qa-modal-close'));
      m.classList.remove('is-open');
    });
  });
  qsa('[data-qa-drawer-open]').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = document.getElementById(b.getAttribute('data-qa-drawer-open'));
      m.hidden = false;
      document.body.classList.add('overflow-hidden');
      b.setAttribute('aria-expanded', 'true');
    });
  });
  qsa('[data-qa-drawer-close]').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = document.getElementById(b.getAttribute('data-qa-drawer-close'));
      m.hidden = true;
      // intentionally leaves body.overflow-hidden in place (scroll lock bug)
    });
  });
  qsa('[data-qa-go-checkout]').forEach(function (b) {
    b.addEventListener('click', function () {
      location.href = '/checkout';
    });
  });
  qsa('[data-beacon]').forEach(function (b) {
    b.addEventListener('click', function () {
      navigator.sendBeacon('/__log?clicked=' + b.getAttribute('data-beacon'));
    });
  });
})();
