/**
 * Navigation du panel admin (#70) pour les essais navigateur : ouvre une rubrique par le menu, comme un utilisateur
 * (bouton ☰ « Rubriques » en fenêtre étroite, groupe replié rouvert si besoin), à toutes les largeurs.
 */
'use strict';

async function admOpenTab(page, tab) {
  const btn = page.locator(`.tab-btn[data-tab="${tab}"]`);
  if (!(await btn.isVisible())) {
    const menu = page.locator('#nav-menu-btn');
    if (await menu.isVisible() && await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
    if (!(await btn.isVisible())) await page.locator(`.nav-group:has(.tab-btn[data-tab="${tab}"]) .nav-group-btn`).click();
  }
  await btn.click();
}

module.exports = { admOpenTab };
