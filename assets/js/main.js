/* ============================================================
   Anki Strahl — Interaktion
   Grundregel: Bewegung erklärt oder bestätigt etwas. Sonst gibt es keine.
   ============================================================ */

(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer  = window.matchMedia('(hover: hover) and (pointer: fine)');
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------- Sätze in Wörter zerlegen ----------
     Jedes Wort bekommt eine Maske und eine eigene Verzögerung. Dadurch
     taucht der Satz auf, wie man ihn sprechen würde — nicht als Block.
     Ohne JS bleibt der Satz ganz normaler Text.                        */

  // Ein <br> im Markup bleibt ein Umbruch. Bei zweiteiligen Sätzen soll jeder
  // Teil auf seiner eigenen Zeile stehen, sonst bricht der Satz irgendwo in der
  // Mitte um und die Parallele geht verloren. Die Verzögerung zählt trotzdem
  // über den Umbruch hinweg weiter — der Satz wird ja am Stück gesprochen.
  const BREAK = '\u0000';

  $$('[data-wash]').forEach((el) => {
    const raw = Array.from(el.childNodes)
      .map((node) => (node.nodeName === 'BR' ? BREAK : node.textContent))
      .join('');

    const tokens = raw.trim().split(/\s+|(\u0000)/).filter(Boolean);
    el.textContent = '';

    let i = 0;
    tokens.forEach((token, pos) => {
      if (token === BREAK) {
        el.appendChild(document.createElement('br'));
        return;
      }

      const mask = document.createElement('span');
      mask.className = 'w';
      mask.style.setProperty('--i', i);
      i += 1;

      const inner = document.createElement('i');
      inner.textContent = token;
      mask.appendChild(inner);

      el.appendChild(mask);
      if (pos < tokens.length - 1 && tokens[pos + 1] !== BREAK) {
        el.appendChild(document.createTextNode(' '));
      }
    });

    // Erst jetzt sichtbar machen. Bis hierhin hält das CSS den Satz auf
    // Deckung 0 — sonst steht er einen Moment fertig da, verschwindet und
    // läuft danach noch einmal wortweise ein.
    el.classList.add('is-split');
  });

  /* ---------- Hero: eine orchestrierte Ladesequenz ---------- */

  const hero = $('.hero');
  if (hero) {
    const start = () => requestAnimationFrame(() => hero.classList.add('is-ready'));

    if (document.fonts && document.fonts.ready) {
      // Warten, bis die Schriften da sind — sonst springt die Headline mitten im Reveal.
      Promise.race([
        document.fonts.ready,
        new Promise((r) => setTimeout(r, 800)),
      ]).then(start);
    } else {
      start();
    }
  }

  /* ---------- Sektions-Reveals ---------- */

  const revealTargets = $$('[data-reveal], [data-wash]').filter((el) => !hero?.contains(el));

  if (!('IntersectionObserver' in window)) {
    revealTargets.forEach((el) => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    revealTargets.forEach((el) => io.observe(el));

    // Sicherheitsnetz nur für das, was ohnehin im Bild steht. Weiter unten
    // wird nichts vorab ausgelöst — sonst fällt der Öltropfen unbemerkt.
    setTimeout(() => {
      revealTargets.forEach((el) => {
        if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add('is-in');
      });
    }, 3000);
  }

  /* ---------- Navigation: hell über dem Hero, dunkel darunter ---------- */

  const nav = $('#nav');

  if (nav) {
    // Der Hero klebt am oberen Rand. Ab dem Punkt, an dem die helle Seite
    // ihn zudeckt, dreht die Leiste ihre Farben um.
    const flipAt = () => (hero ? hero.offsetHeight - nav.offsetHeight : 8);

    const syncTop = () => {
      nav.classList.toggle('is-stuck', window.scrollY > flipAt());
    };

    let navTicking = false;
    window.addEventListener('scroll', () => {
      if (navTicking) return;
      navTicking = true;
      requestAnimationFrame(() => { syncTop(); navTicking = false; });
    }, { passive: true });

    window.addEventListener('resize', syncTop);
    syncTop();
  }

  /* ---------- Mobiles Menü ---------- */

  const toggle = $('#navToggle');
  const panel  = $('#navPanel');

  if (toggle && panel) {
    $$('a', panel).forEach((el, i) => el.style.setProperty('--i', i));

    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('.nav__toggle-label').textContent = open ? 'Schließen' : 'Menü';
      document.body.style.overflow = open ? 'hidden' : '';
      // Die Leiste steht über dem Panel und muss dessen helle Fläche annehmen.
      nav?.classList.toggle('is-panel', open);

      if (open) {
        panel.hidden = false;
        requestAnimationFrame(() => panel.classList.add('is-open'));
        $('a', panel)?.focus({ preventScroll: true });
      } else {
        panel.classList.remove('is-open');
        // Erst nach der Ausblendung aus dem Dokumentfluss nehmen.
        setTimeout(() => { panel.hidden = true; }, reduceMotion.matches ? 0 : 240);
      }
    };

    toggle.addEventListener('click', () => {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    panel.addEventListener('click', (e) => {
      if (e.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });

    // Beim Wechsel auf Desktop das Panel sauber zurücksetzen.
    window.matchMedia('(min-width: 64rem)').addEventListener('change', (e) => {
      if (e.matches && toggle.getAttribute('aria-expanded') === 'true') setOpen(false);
    });
  }

  /* ---------- Parallax ----------
     Zwei Fälle. Der Hero klebt oben, also zählt dort die reine Scrollhöhe.
     Alles andere läuft relativ zur eigenen Position im Bild — dadurch steht
     jedes Element beim Durchlaufen genau einmal in seiner Ruhelage.        */

  const parallaxEls = $$('[data-parallax]');

  if (parallaxEls.length && !reduceMotion.matches) {
    // Am Finger läuft die Bewegung mit — eine Seite ohne Tiefe fühlt sich
    // mobil tot an. Nur gedämpfter, weil auf dem schmalen Bild jeder Pixel
    // Versatz stärker auffällt.
    const damp = finePointer.matches ? 1 : 0.55;

    // Der Hero ist der eine Fall, der stillstehen muss: unter 48rem füllt
    // das Bild die Höhe exakt aus (.hero__shift { inset: 0 }), jede
    // Verschiebung risse unten einen Streifen auf. Die Grenze ist deshalb
    // dieselbe wie im CSS — die Breite, nicht der Zeigertyp.
    const narrow = window.matchMedia('(max-width: 48rem)');

    const layers = parallaxEls.map((el) => ({
      el,
      factor: (parseFloat(el.dataset.parallax) || 0) * damp,
      pinned: !!hero?.contains(el),
    }));

    let ticking = false;

    const update = () => {
      const vh = window.innerHeight;

      const skipHero = narrow.matches;

      layers.forEach(({ el, factor, pinned }) => {
        if (pinned) {
          if (skipHero) { el.style.transform = ''; return; }
          const y = window.scrollY;
          if (y > vh * 1.5) return;
          el.style.transform = `translate3d(0, ${(y * factor).toFixed(2)}px, 0)`;
          return;
        }

        const rect = el.getBoundingClientRect();
        if (rect.bottom < -vh * 0.5 || rect.top > vh * 1.5) return;

        // Abstand der Elementmitte von der Bildmitte, in Pixeln.
        const d = vh / 2 - (rect.top + rect.height / 2);
        el.style.transform = `translate3d(0, ${(d * factor).toFixed(2)}px, 0)`;
      });

      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });

    window.addEventListener('resize', update);
    narrow.addEventListener('change', update);
    update();
  }

  /* ---------- Filmstreifen ---------- */

  const track = $('#stripTrack');

  if (track) {
    const slides = $$('.slide', track);
    const prevBtn = $('[data-strip-prev]');
    const nextBtn = $('[data-strip-next]');

    const slideCenter = (slide) => slide.offsetLeft + slide.offsetWidth / 2;
    const viewCenter  = () => track.scrollLeft + track.clientWidth / 2;

    const nearestIndex = (target = viewCenter()) => {
      let best = 0, bestDist = Infinity;
      slides.forEach((slide, i) => {
        const dist = Math.abs(slideCenter(slide) - target);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      return best;
    };

    const goTo = (index, smooth = true) => {
      const slide = slides[Math.max(0, Math.min(slides.length - 1, index))];
      if (!slide) return;
      track.scrollTo({
        left: slideCenter(slide) - track.clientWidth / 2,
        behavior: smooth && !reduceMotion.matches ? 'smooth' : 'auto',
      });
    };

    /* Aktiven Slide markieren: nur das mittlere Bild ist farbig. */
    let syncing = false;
    const sync = () => {
      const active = nearestIndex();
      slides.forEach((slide, i) => slide.classList.toggle('is-active', i === active));

      const max = track.scrollWidth - track.clientWidth;
      if (prevBtn) prevBtn.disabled = track.scrollLeft <= 2;
      if (nextBtn) nextBtn.disabled = track.scrollLeft >= max - 2;

      syncing = false;
    };

    track.addEventListener('scroll', () => {
      if (!syncing) { syncing = true; requestAnimationFrame(sync); }
    }, { passive: true });

    window.addEventListener('resize', sync);
    sync();

    prevBtn?.addEventListener('click', () => goTo(nearestIndex() - 1));
    nextBtn?.addEventListener('click', () => goTo(nearestIndex() + 1));

    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(nearestIndex() + 1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); goTo(nearestIndex() - 1); }
      if (e.key === 'Home')       { e.preventDefault(); goTo(0); }
      if (e.key === 'End')        { e.preventDefault(); goTo(slides.length - 1); }
    });

    /* Ziehen mit Schwung.
       Ein kurzes Wischen reicht — kein Ziehen über eine Schwelle. */
    if (finePointer.matches) {
      let dragging = false, startX = 0, startScroll = 0, lastX = 0, lastT = 0, velocity = 0;

      track.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        dragging = true;
        startX = lastX = e.clientX;
        startScroll = track.scrollLeft;
        lastT = e.timeStamp;
        velocity = 0;
        track.classList.add('is-dragging');
        track.setPointerCapture(e.pointerId);
      });

      track.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dt = e.timeStamp - lastT;
        if (dt > 0) velocity = (e.clientX - lastX) / dt;
        lastX = e.clientX;
        lastT = e.timeStamp;
        track.scrollLeft = startScroll - (e.clientX - startX);
      });

      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        track.classList.remove('is-dragging');
        if (track.hasPointerCapture?.(e.pointerId)) track.releasePointerCapture(e.pointerId);

        // Schwung in eine Zielposition übersetzen, dann auf den nächsten Slide einrasten.
        const projected = track.scrollLeft - velocity * 220 + track.clientWidth / 2;
        goTo(nearestIndex(projected));
      };

      track.addEventListener('pointerup', endDrag);
      track.addEventListener('pointercancel', endDrag);

      // Ein Klick nach dem Ziehen darf keinen Link auslösen.
      track.addEventListener('click', (e) => {
        if (Math.abs(lastX - startX) > 6) { e.preventDefault(); e.stopPropagation(); }
      }, true);
    }
  }

  /* ---------- Der Funnel ----------
     Drei Schritte statt eines langen Formulars: Thema, Nachricht, Kontakt.
     Wer schon weiß, worum es geht — etwa über „Ich komme" —, überspringt
     den ersten. Schritt 4 ist die Bestätigung und wird nicht mitgezählt. */

  const funnel = $('#funnel');
  let goToStep = null;
  let validateField = null;

  if (funnel && typeof funnel.showModal === 'function') {
    const STEPS = [1, 2, 3, 4];
    const panes = Object.fromEntries(
      STEPS.map((n) => [n, $(`[data-pane="${n}"]`, funnel)])
    );
    const sheet = $('.funnel__sheet', funnel);
    const progress = $('#funnelProgress');
    const stepLabel = $('#funnelStepLabel');
    const titleEl = $('#funnelTitle');
    const topicIn = $('#f-topic', funnel);

    // Der zweite Schritt heißt nicht mehr „Worum geht es?" — die Frage
    // ist ja beantwortet. Er nimmt die Antwort als Überschrift auf.
    const titles = {
      'Yoga':          'Schön. Erzähl mir kurz von dir.',
      'Öle':           'Wobei soll ein Öl dir helfen?',
      'Etwas anderes': 'Dann schreib einfach los.',
    };

    let lastTrigger = null;

    const showStep = (step, topic) => {
      STEPS.forEach((n) => { panes[n].hidden = step !== n; });

      // Es gibt nur eine Sonne. Über drei Schritte kommen ihre Strahlen dazu,
      // auf der Bestätigung wächst dieselbe Sonne in die Mitte des Blattes und
      // bekommt den Haken. Deshalb bleibt sie auf Schritt 4 stehen und behält
      // ihre drei Drittel — .is-done macht den Rest.
      sheet.classList.toggle('is-done', step === 4);
      progress.dataset.step = Math.min(step, 3);
      if (step !== 4) stepLabel.textContent = `Schritt ${step} von 3`;

      if (step === 4) {
        titleEl.textContent = 'Danke dir.';
        titleEl.focus({ preventScroll: true });
      } else if (step === 3) {
        titleEl.textContent = 'Wie erreiche ich dich?';
        if (finePointer.matches) $('#f-name', funnel)?.focus({ preventScroll: true });
        else titleEl.focus({ preventScroll: true });
      } else if (step === 2) {
        if (topic) topicIn.value = topic;
        titleEl.textContent = titles[topicIn.value] || titles['Etwas anderes'];
        // Am Finger nicht ins Feld springen: die Tastatur schöbe sich sofort
        // über das halbe Blatt, bevor man die Frage gelesen hat. Stattdessen
        // bekommt die Überschrift den Fokus — Vorlesehilfen sagen sie an.
        if (finePointer.matches) $('#f-msg', funnel)?.focus({ preventScroll: true });
        else titleEl.focus({ preventScroll: true });
      } else {
        titleEl.textContent = 'Worum geht es?';
        $('.topic', funnel)?.focus({ preventScroll: true });
      }

      funnel.scrollTop = 0;
    };

    // showModal() setzt den Fokus selbst — auf das erste bedienbare Element,
    // also das Kreuz. Deshalb erst öffnen, dann den Schritt aufbauen: so
    // landet der Fokus dort, wo man weiterliest, und nicht am Schließen.
    const open = (topic) => {
      funnel.showModal();
      showStep(topic ? 2 : 1, topic);
      document.body.style.overflow = 'hidden';
    };

    funnel.addEventListener('close', () => {
      document.body.style.overflow = '';
      lastTrigger?.focus({ preventScroll: true });
      lastTrigger = null;
    });

    $$('[data-funnel]').forEach((trigger) => {
      trigger.addEventListener('click', () => {
        lastTrigger = trigger;
        open(trigger.dataset.funnel || '');
      });
    });

    $$('.topic', funnel).forEach((btn) => {
      btn.addEventListener('click', () => showStep(2, btn.dataset.topic));
    });

    $$('[data-funnel-back]', funnel).forEach((btn) => {
      btn.addEventListener('click', () => showStep(Number(btn.dataset.back) || 1));
    });

    // Der Weiter-Knopf prüft nur den Schritt, auf dem man steht. Wer die
    // Nachricht leer lässt, käme sonst bis zum Absenden und wird erst dort
    // zurückgeschickt.
    $('[data-funnel-next]', funnel)?.addEventListener('click', () => {
      const open = $$('[required]', panes[2]);
      const bad = open.filter((input) => validateField?.(input) === false);
      if (bad.length) { bad[0].focus({ preventScroll: false }); return; }
      showStep(3);
    });

    $$('[data-funnel-close]', funnel).forEach((btn) => {
      btn.addEventListener('click', () => funnel.close());
    });

    // Das Formular steht in einem eigenen Block weiter unten und kommt
    // sonst nicht an showStep heran.
    goToStep = showStep;

    // Klick auf die Fläche daneben schließt. Das Dialogelement selbst füllt
    // den Bildschirm nicht, der Backdrop zählt aber als Treffer auf ihm.
    funnel.addEventListener('click', (e) => {
      if (e.target === funnel) funnel.close();
    });
  }

  /* ---------- Kontaktformular ---------- */

  const form = $('#contactForm');

  if (form) {
    const status = $('#formStatus');

    const fieldOf = (input) => input.closest('.field');
    const errorOf = (input) => $(`[data-error-for="${input.id}"]`, form);

    const setError = (input, show) => {
      fieldOf(input)?.classList.toggle('is-invalid', show);
      input.setAttribute('aria-invalid', String(show));
      const err = errorOf(input);
      if (err) err.hidden = !show;
    };

    const validate = (input) => {
      const ok = input.checkValidity() && input.value.trim() !== '';
      setError(input, !ok);
      return ok;
    };

    // Der Weiter-Knopf im Funnel prüft damit den Schritt, auf dem man steht.
    validateField = validate;

    $$('input, textarea', form).forEach((input) => {
      // Erst nach dem Verlassen meckern, dann live korrigieren.
      input.addEventListener('blur', () => { if (input.required) validate(input); });
      input.addEventListener('input', () => {
        if (fieldOf(input)?.classList.contains('is-invalid')) validate(input);
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const required = $$('[required]', form);
      const invalid = required.filter((input) => !validate(input));

      if (invalid.length) {
        // Die Nachricht steht auf einem anderen Schritt. Ist ausgerechnet
        // die leer, muss man erst dorthin zurück — sonst zeigt der Funnel
        // einen Fehler zu einem Feld, das gerade niemand sieht.
        const pane = invalid[0].closest('[data-pane]');
        if (pane?.hidden) goToStep?.(Number(pane.dataset.pane));
        invalid[0].focus({ preventScroll: false });
        if (status) {
          status.hidden = false;
          status.textContent = 'Da fehlt noch etwas — schau bitte kurz über die markierten Felder.';
        }
        return;
      }

      /* Es geht bewusst nichts raus. Solange kein Backend angebunden ist,
         zeigt das Formular nur die Bestätigung, damit sich der Ablauf
         testen lässt. Später kommt hier ein fetch() auf den n8n-Webhook
         davor, und erst dessen Antwort schaltet weiter. */
      if (status) { status.hidden = true; status.textContent = ''; }
      goToStep?.(4);
      form.reset();
    });
  }
})();
