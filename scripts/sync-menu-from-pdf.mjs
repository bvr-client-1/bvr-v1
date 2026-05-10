import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: false });

const catalog = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'menu-pdf-catalog.json'), 'utf8'),
);

const canonicalCategories = catalog.map((category, index) => ({
  name: category.name,
  sortOrder: index + 1,
}));

const roundRaisedPrice = (basePrice) => Math.ceil((Number(basePrice) * 1.2) / 5) * 5;

const canonicalItems = catalog.flatMap((category) =>
  category.items.map(([name, basePrice]) => ({
    name,
    categoryName: category.name,
    basePrice: Number(basePrice),
    finalPrice: roundRaisedPrice(basePrice),
  })),
);

const normalize = (value) => String(value || '').trim().toLowerCase();

const printPreview = () => {
  console.log(`Categories: ${canonicalCategories.length}`);
  console.log(`Items: ${canonicalItems.length}`);
  console.log('');
  canonicalItems.slice(0, 20).forEach((item) => {
    console.log(
      `${item.categoryName.padEnd(26)} | ${item.name.padEnd(36)} | ${item.basePrice
        .toString()
        .padStart(4)} -> ${item.finalPrice}`,
    );
  });
};

const sqlQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;

const buildSql = () => {
  const categoryRows = canonicalCategories
    .map((category) => `  (${sqlQuote(category.name)}, ${category.sortOrder})`)
    .join(',\n');

  const itemRows = canonicalItems
    .map(
      (item) =>
        `  (${sqlQuote(item.name)}, ${sqlQuote(item.categoryName)}, ${item.basePrice}, ${item.finalPrice})`,
    )
    .join(',\n');

  return `begin;

create temp table canonical_categories (
  name text not null,
  sort_order integer not null
);

insert into canonical_categories (name, sort_order)
values
${categoryRows};

create temp table canonical_menu (
  name text not null,
  category_name text not null,
  base_price numeric(10,2) not null,
  final_price numeric(10,2) not null
);

insert into canonical_menu (name, category_name, base_price, final_price)
values
${itemRows};

insert into menu_categories (name, sort_order)
select cc.name, cc.sort_order
from canonical_categories cc
where not exists (
  select 1
  from menu_categories mc
  where lower(mc.name) = lower(cc.name)
);

update menu_categories mc
set sort_order = cc.sort_order
from canonical_categories cc
where lower(mc.name) = lower(cc.name);

update menu_items mi
set
  category_id = mc.id,
  price = cm.final_price,
  is_available = true
from canonical_menu cm
join menu_categories mc on lower(mc.name) = lower(cm.category_name)
where lower(mi.name) = lower(cm.name);

insert into menu_items (name, description, price, category_id, is_available)
select cm.name, '', cm.final_price, mc.id, true
from canonical_menu cm
join menu_categories mc on lower(mc.name) = lower(cm.category_name)
where not exists (
  select 1
  from menu_items mi
  where lower(mi.name) = lower(cm.name)
);

update menu_items
set is_available = false
where lower(name) not in (select lower(name) from canonical_menu);

commit;
`;
};

const ensureEnv = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to sync the menu. Add them to .env or .env.local.',
    );
  }

  return { url, key };
};

const syncCategories = async (supabase) => {
  const { data: existingCategories, error: readError } = await supabase
    .from('menu_categories')
    .select('id, name, sort_order');

  if (readError) {
    throw readError;
  }

  const existingByName = new Map(
    (existingCategories || []).map((category) => [normalize(category.name), category]),
  );

  for (const category of canonicalCategories) {
    const existing = existingByName.get(normalize(category.name));
    if (!existing) {
      const { error } = await supabase.from('menu_categories').insert({
        name: category.name,
        sort_order: category.sortOrder,
      });
      if (error) throw error;
      continue;
    }

    if (existing.sort_order !== category.sortOrder) {
      const { error } = await supabase
        .from('menu_categories')
        .update({ sort_order: category.sortOrder })
        .eq('id', existing.id);
      if (error) throw error;
    }
  }

  const { data: refreshedCategories, error: refreshError } = await supabase
    .from('menu_categories')
    .select('id, name, sort_order');

  if (refreshError) {
    throw refreshError;
  }

  return new Map(
    (refreshedCategories || []).map((category) => [normalize(category.name), category]),
  );
};

const syncItems = async (supabase, categoryMap) => {
  const { data: existingItems, error: readError } = await supabase
    .from('menu_items')
    .select('id, name, category_id, price, is_available, image_url, description');

  if (readError) {
    throw readError;
  }

  const existingByName = new Map((existingItems || []).map((item) => [normalize(item.name), item]));
  const canonicalNames = new Set(canonicalItems.map((item) => normalize(item.name)));

  let inserted = 0;
  let updated = 0;
  let disabled = 0;

  for (const item of canonicalItems) {
    const category = categoryMap.get(normalize(item.categoryName));
    if (!category) {
      throw new Error(`Menu category not found during sync: ${item.categoryName}`);
    }

    const existing = existingByName.get(normalize(item.name));
    if (!existing) {
      const { error } = await supabase.from('menu_items').insert({
        name: item.name,
        description: '',
        price: item.finalPrice,
        category_id: category.id,
        is_available: true,
      });
      if (error) throw error;
      inserted += 1;
      continue;
    }

    const needsUpdate =
      Number(existing.price) !== item.finalPrice ||
      existing.category_id !== category.id ||
      existing.is_available !== true;

    if (!needsUpdate) {
      continue;
    }

    const { error } = await supabase
      .from('menu_items')
      .update({
        price: item.finalPrice,
        category_id: category.id,
        is_available: true,
      })
      .eq('id', existing.id);

    if (error) throw error;
    updated += 1;
  }

  for (const item of existingItems || []) {
    if (canonicalNames.has(normalize(item.name)) || item.is_available === false) {
      continue;
    }

    const { error } = await supabase
      .from('menu_items')
      .update({ is_available: false })
      .eq('id', item.id);

    if (error) throw error;
    disabled += 1;
  }

  const { data: refreshedItems, error: refreshError } = await supabase
    .from('menu_items')
    .select('id, name, price, is_available')
    .eq('is_available', true)
    .order('name');

  if (refreshError) {
    throw refreshError;
  }

  const activeByName = new Map();
  for (const item of refreshedItems || []) {
    const key = normalize(item.name);
    const list = activeByName.get(key) || [];
    list.push(item);
    activeByName.set(key, list);
  }

  const canonicalPriceByName = new Map(
    canonicalItems.map((item) => [normalize(item.name), Number(item.finalPrice)]),
  );

  for (const [key, list] of activeByName.entries()) {
    if (list.length <= 1) {
      continue;
    }

    const canonicalPrice = canonicalPriceByName.get(key);
    const sorted = [...list].sort((left, right) => {
      const leftMatches = Number(left.price) === canonicalPrice ? 1 : 0;
      const rightMatches = Number(right.price) === canonicalPrice ? 1 : 0;
      if (leftMatches !== rightMatches) {
        return rightMatches - leftMatches;
      }
      return String(left.id).localeCompare(String(right.id));
    });

    const keep = sorted[0];
    const toDisable = sorted.slice(1);

    for (const duplicate of toDisable) {
      const { error } = await supabase
        .from('menu_items')
        .update({ is_available: false })
        .eq('id', duplicate.id);

      if (error) {
        throw error;
      }
      disabled += 1;
    }
  }

  return { inserted, updated, disabled };
};

const main = async () => {
  const args = new Set(process.argv.slice(2));
  if (args.has('--preview')) {
    printPreview();
    return;
  }
  if (args.has('--sql')) {
    process.stdout.write(buildSql());
    return;
  }

  const { url, key } = ensureEnv();
  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log(`Syncing ${canonicalItems.length} menu items across ${canonicalCategories.length} categories...`);

  const categoryMap = await syncCategories(supabase);
  const result = await syncItems(supabase, categoryMap);

  console.log('Menu sync complete.');
  console.log(`Inserted: ${result.inserted}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Marked unavailable: ${result.disabled}`);
};

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
