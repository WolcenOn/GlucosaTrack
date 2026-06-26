/*
  Puente Gestor de Alimentación → GlucosaTrack
  ------------------------------------------------
  Convierte ingredientes y platos del gestor en alimentos compatibles con
  GlucosaTrack, usando los perfiles nutricionales guardados en:
  localStorage["gestorMenuSemanal.state.v1"].

  Nota: localStorage solo se comparte si ambas apps se sirven desde el mismo
  origen. Si no, usa exportación JSON desde el Gestor e importación manual aquí.
*/
(function () {
  const GESTOR_STATE_KEY = "gestorMenuSemanal.state.v1";
  const BRIDGE_CACHE_KEY = "glucosaTrack.gestorBridge.foods.v1";

  function r(value, decimals = 2) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? Number(n.toFixed(decimals)) : 0;
  }

  function safeJson(raw, fallback = null) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function readGestorState() {
    return safeJson(localStorage.getItem(GESTOR_STATE_KEY), null);
  }

  function profileFactor(profile, qty = 100, unit = "g") {
    const amount = Number(qty || 0);
    const per = Number(profile?.per || 100) || 100;
    const lineUnit = String(unit || "g").toLowerCase();
    if (lineUnit === "kg" || lineUnit === "l") return (amount * 1000) / per;
    if (lineUnit === "unidades") return amount;
    return amount / per;
  }

  function activeSnapshotFromIngredient(state, ingredient) {
    const activeProduct = (ingredient.products || []).find(product => product.activeNutrition && product.nutritionSnapshot)
      || (ingredient.products || []).find(product => product.nutritionSnapshot);
    if (activeProduct?.nutritionSnapshot) return activeProduct.nutritionSnapshot;
    return (state.nutritionProfiles || []).find(profile => profile.ingredientId === ingredient.id) || null;
  }

  function macroFromProfile(profile, factor = 1) {
    const carbs = Number(profile?.carbs || 0) * factor;
    const sugars = Math.min(Number(profile?.sugar || profile?.sugars || 0) * factor, carbs);
    return {
      kcal: Number(profile?.kcal || 0) * factor,
      fats: Number(profile?.fat || profile?.fats || 0) * factor,
      proteins: Number(profile?.protein || profile?.proteins || 0) * factor,
      carbs,
      sugars,
      complexCarbs: Math.max(0, carbs - sugars)
    };
  }

  function addMacro(target, macro) {
    target.kcal += Number(macro.kcal || 0);
    target.fats += Number(macro.fats || 0);
    target.proteins += Number(macro.proteins || 0);
    target.carbs += Number(macro.carbs || 0);
    target.sugars += Number(macro.sugars || 0);
    target.complexCarbs += Number(macro.complexCarbs || 0);
    return target;
  }

  function emptyMacro() {
    return { kcal: 0, fats: 0, proteins: 0, carbs: 0, sugars: 0, complexCarbs: 0 };
  }

  function normalizeFood(food) {
    return {
      ...food,
      kcal: r(food.kcal, 0),
      fats: r(food.fats),
      proteins: r(food.proteins),
      carbs: r(food.carbs),
      sugars: r(food.sugars),
      complexCarbs: r(food.complexCarbs)
    };
  }

  function ingredientToGlucosaFood(state, ingredient) {
    const profile = activeSnapshotFromIngredient(state, ingredient);
    if (!profile) return null;
    const macro = macroFromProfile(profile, profileFactor(profile, 100, profile.unit || "g"));
    const product = (ingredient.products || []).find(item => item.activeNutrition) || (ingredient.products || [])[0] || {};
    return normalizeFood({
      id: `gestor_ingredient_${ingredient.id}`,
      gestorType: "ingredient",
      gestorId: ingredient.id,
      name: ingredient.name || "Ingrediente",
      brand: ["Gestor de Alimentación", product.brand].filter(Boolean).join(" · "),
      image: product.imageThumbUrl || product.image_thumb_url || null,
      imageFull: product.imageUrl || product.image_url || null,
      ...macro
    });
  }

  function dishToGlucosaFood(state, dish) {
    const ingredients = new Map((state.ingredients || []).map(item => [item.id, item]));
    const total = emptyMacro();
    const missing = [];

    for (const line of dish.recipe || []) {
      const ingredient = ingredients.get(line.ingredientId);
      const profile = ingredient ? activeSnapshotFromIngredient(state, ingredient) : null;
      if (!ingredient || !profile) {
        missing.push(ingredient?.name || line.ingredientId);
        continue;
      }
      addMacro(total, macroFromProfile(profile, profileFactor(profile, line.qty, line.unit || ingredient.unit || "g")));
    }

    if (!(dish.recipe || []).length || missing.length === (dish.recipe || []).length) return null;
    return normalizeFood({
      id: `gestor_dish_${dish.id}`,
      gestorType: "dish",
      gestorId: dish.id,
      name: dish.name || "Plato del gestor",
      brand: missing.length ? `Gestor de Alimentación · faltan datos: ${missing.slice(0, 3).join(", ")}` : "Gestor de Alimentación · plato completo",
      image: null,
      imageFull: null,
      ...total
    });
  }

  function buildFoodsFromGestorState(state) {
    if (!state || typeof state !== "object") return [];
    const ingredientFoods = (state.ingredients || []).map(ingredient => ingredientToGlucosaFood(state, ingredient)).filter(Boolean);
    const dishFoods = (state.dishes || []).map(dish => dishToGlucosaFood(state, dish)).filter(Boolean);
    return [...dishFoods, ...ingredientFoods];
  }

  function getBridgeFoods() {
    const state = readGestorState();
    const foods = buildFoodsFromGestorState(state);
    if (foods.length) {
      localStorage.setItem(BRIDGE_CACHE_KEY, JSON.stringify({ updatedAt: new Date().toISOString(), foods }));
      return foods;
    }
    return safeJson(localStorage.getItem(BRIDGE_CACHE_KEY), { foods: [] })?.foods || [];
  }

  function injectStyles() {
    if (document.getElementById("gestorBridgeStyles")) return;
    const style = document.createElement("style");
    style.id = "gestorBridgeStyles";
    style.textContent = `
      .gestor-bridge-box{background:linear-gradient(135deg,rgba(26,127,110,.08),rgba(59,130,246,.05));border:1px solid rgba(26,127,110,.18);border-radius:16px;padding:12px;margin-bottom:14px}
      .gestor-bridge-title{font-weight:900;font-size:14px;color:var(--primary-dk);margin-bottom:4px}
      .gestor-bridge-text{font-size:12px;color:var(--muted);line-height:1.45;margin-bottom:10px}
      .gestor-bridge-actions{display:flex;gap:8px;flex-wrap:wrap}
      .gestor-bridge-actions .btn{font-size:12px;padding:9px 12px}
      .gestor-bridge-file input{display:none}
    `;
    document.head.append(style);
  }

  function renderGestorFoods() {
    const el = document.getElementById("search-results");
    if (!el) return;
    const foods = getBridgeFoods();
    if (!foods.length) {
      el.innerHTML = '<div class="empty-state"><div class="emoji">🥗</div><div class="title">No hay datos nutricionales del Gestor</div><div class="sub">Abre el Gestor en el mismo navegador o importa un JSON exportado.</div></div>';
      return;
    }
    foods.forEach(food => window.registerFood?.(food));
    el.innerHTML = foods.map(food => window.buildFoodCard ? window.buildFoodCard(food) : `<div class="food-card"><strong>${food.name}</strong></div>`).join("");
    window.toast?.(`${foods.length} alimento(s)/plato(s) cargados desde el Gestor`);
  }

  function importGestorJsonFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const state = safeJson(String(reader.result || ""), null);
      const foods = buildFoodsFromGestorState(state);
      if (!foods.length) {
        window.toast?.("El JSON no contiene perfiles nutricionales utilizables", "err");
        return;
      }
      localStorage.setItem(BRIDGE_CACHE_KEY, JSON.stringify({ updatedAt: new Date().toISOString(), foods }));
      renderGestorFoods();
    };
    reader.readAsText(file);
  }

  function injectBridgeBox() {
    if (document.getElementById("gestorBridgeBox")) return;
    const searchRow = document.getElementById("search-row");
    if (!searchRow?.parentElement) return;
    const box = document.createElement("div");
    box.id = "gestorBridgeBox";
    box.className = "gestor-bridge-box";
    box.innerHTML = `
      <div class="gestor-bridge-title">🥗 Datos del Gestor de Alimentación</div>
      <div class="gestor-bridge-text">Carga ingredientes y platos con perfil nutricional del gestor para usarlos en las curvas, desglose e insulina de GlucosaTrack.</div>
      <div class="gestor-bridge-actions">
        <button type="button" class="btn btn-green" id="loadGestorFoodsBtn">Usar datos del Gestor</button>
        <label class="btn btn-grey gestor-bridge-file">Importar JSON del Gestor<input type="file" id="gestorJsonFile" accept="application/json,.json"></label>
      </div>
    `;
    searchRow.parentElement.insertBefore(box, searchRow.nextSibling);
    document.getElementById("loadGestorFoodsBtn")?.addEventListener("click", renderGestorFoods);
    document.getElementById("gestorJsonFile")?.addEventListener("change", event => importGestorJsonFile(event.target.files?.[0]));
  }

  function boot() {
    injectStyles();
    injectBridgeBox();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.GestorNutritionBridge = { getBridgeFoods, renderGestorFoods, buildFoodsFromGestorState };
})();
