# Family Week Scenario — Inventory System Test Plan

**Family:** Sam & Jordan (parents), two kids (ages 8 and 12)
**Starting state:** Partially stocked kitchen, some items tracked, some not. Mix of fresh and pantry staples. A few things close to expiring from last week.

---

## Day 1 — Monday

1. Jordan opens the app to plan the week's meals. Notices the **expiring alert**: yogurt (expires tomorrow), leftover chili from last Thursday (3 days old, marked as leftover).
2. Jordan checks the fridge physically. The yogurt is fine — pushes the expiry to Wednesday. Edits the yogurt item's expiry date to April 16.
3. Kids eat the last of the leftover chili for lunch. Jordan marks the chili leftover as **finished**.
4. Jordan plans Monday dinner: **Chicken stir-fry**. Opens the recipe → adds ingredients to shopping list.
5. Jordan scans the pantry. They already have soy sauce, sesame oil, and rice. Removes those from the shopping list ("I already have this").
6. Jordan notices they're almost out of olive oil. Adds "olive oil" to shopping list manually (not from a recipe).
7. Sam adds **Spaghetti Bolognese** (Wednesday dinner) to the meal plan. Its ingredients auto-add to the shopping list. Some overlap with stir-fry (garlic, onion) — system consolidates.
8. Jordan cooks the **chicken stir-fry** using chicken from the freezer. Marks the recipe as cooked. Depletion confirmation: used all ingredients as listed, but substituted regular soy sauce for low-sodium.
9. There's enough stir-fry for 3 extra portions. Jordan adds a **leftover**: "Chicken stir-fry", 3 portions, fridge, expires Thursday.

## Day 2 — Tuesday

1. Sam does the **grocery run** in the morning. Opens the shopping list in the app — sees 14 items organized by category.
2. At the store, Sam checks off items as they go: chicken breast, ground beef, onions (3), garlic, bell peppers (3), broccoli, spaghetti, crushed tomatoes (2 cans), parmesan, heavy cream, olive oil, bread, milk.
3. Sam can't find fresh basil. Skips it ("Skipping this item").
4. At checkout, Sam also grabs bananas and cereal — not on the list. Adds them to shopping list and checks them off immediately.
5. Home: Sam puts away groceries. The app prompts **put-away flow** — suggests areas based on item defaults:
   - Chicken breast → Fridge (expiry: April 18)
   - Ground beef → Fridge (expiry: April 17)
   - Onions → Pantry (no expiry)
   - Garlic → Pantry (no expiry)
   - Bell peppers → Fridge (expiry: April 20)
   - Broccoli → Fridge (expiry: April 18)
   - Spaghetti → Pantry
   - Crushed tomatoes → Pantry
   - Parmesan → Fridge (expiry: May 15)
   - Heavy cream → Fridge (expiry: April 22)
   - Olive oil → Pantry
   - Bread → Pantry (expiry: April 19)
   - Milk → Fridge (expiry: April 21)
   - Bananas → Counter/Pantry (expiry: April 18)
   - Cereal → Pantry
6. Kid #1 eats yogurt for snack. The yogurt (which Jordan extended to Wed) is now down to 1 serving. Jordan edits yogurt quantity.
7. Family eats **leftover chicken stir-fry** for dinner (2 portions used). Jordan updates leftover: 1 portion remaining.

## Day 3 — Wednesday

1. Morning: kid #2 finishes the last yogurt. Jordan marks yogurt as **out of stock** and adds it to shopping list.
2. Kid #1 eats the last portion of chicken stir-fry leftover. Jordan marks the leftover as **finished**.
3. Jordan cooks **Spaghetti Bolognese** for dinner. Opens recipe, starts cook mode.
4. Mid-cook: Jordan realizes they're out of garlic — used more than expected in the stir-fry Monday. Marks garlic as **out of stock** mid-cook. App asks: "Add to shopping list?" — Yes. App suggests: "You have garlic powder in the pantry as a substitute."
5. Jordan finishes cooking. Depletion confirmation: all ingredients used except garlic (marked out). Used 1 lb ground beef, 1 can crushed tomatoes, half the parmesan, half the heavy cream.
6. Lots of bolognese left. Jordan adds **leftover**: "Spaghetti Bolognese", 5 portions, fridge, expires Saturday.
7. Sam notices the bananas are ripening fast. Edits expiry from April 18 → April 16 (tomorrow).

## Day 4 — Thursday

1. Morning: bananas are overripe. Sam moves 3 bananas to the freezer for future banana bread. Edits the banana item: moves to Freezer, updates expiry to May 15.
2. Kids take bolognese leftovers for school lunch (2 portions). Jordan updates leftover: 3 portions remaining.
3. Jordan checks the **expiring items** view. Sees: ground beef (expires tomorrow), bread (expires Saturday), broccoli (expires tomorrow).
4. Jordan decides to cook the **ground beef tonight** before it expires — makes **tacos** (not a saved recipe, ad-hoc cooking). Manually depletes: 1 lb ground beef, 3 tortillas, shredded cheese, salsa, lettuce.
5. Jordan also cooks the broccoli as a side — steamed broccoli. Depletes broccoli.
6. No leftovers from tacos — family ate it all.
7. Sam adds **Banana Bread** to the meal plan for Saturday (to use the frozen bananas).

## Day 5 — Friday

1. **Pizza night** — family orders delivery. No cooking, no depletion.
2. Jordan adds the leftover pizza as a **leftover**: "Pepperoni pizza", 4 slices, fridge, expires Monday.
3. Kid #2 drinks the last of the milk. Jordan marks milk as **out of stock**. App auto-adds to shopping list (milk is a "keep in stock" item).
4. Sam eats bolognese for lunch (1 portion). Jordan updates leftover: 2 portions remaining.
5. Jordan reviews the **shopping list** for a quick weekend run. Current list: yogurt, garlic, milk, plus anything needed for banana bread and weekend meals.
6. Sam adds **Chicken Caesar Salad** for Sunday dinner. Ingredients added to shopping list: romaine lettuce, caesar dressing, croutons. Chicken breast already in fridge (bought Tuesday).

## Day 6 — Saturday

1. Sam does a **quick grocery run**: yogurt (2 packs), garlic, milk, romaine lettuce, caesar dressing, croutons, eggs (for banana bread), lemons. Checks off everything.
2. Put-away flow:
   - Yogurt → Fridge (expiry: April 26)
   - Garlic → Pantry
   - Milk → Fridge (expiry: April 28)
   - Romaine → Fridge (expiry: April 20)
   - Caesar dressing → Fridge (expiry: June 1)
   - Croutons → Pantry (expiry: May 30)
   - Eggs → Fridge (expiry: May 5)
   - Lemons → Fridge (expiry: April 25)
3. Jordan bakes **Banana Bread**. Takes bananas out of freezer. Cook mode → depletion: 3 bananas, 2 eggs, flour (from pantry), sugar, butter.
4. Banana bread makes 1 loaf. Jordan adds **leftover**: "Banana bread", 8 slices, pantry, expires Wednesday.
5. Family eats last 2 portions of bolognese for lunch. Jordan marks the leftover as **finished**.
6. Sam makes a simple pasta with the remaining heavy cream and parmesan for dinner. Ad-hoc depletion: heavy cream (finish it), spaghetti (half box), parmesan (rest of the wedge).
7. Jordan checks inventory. The crushed tomatoes (2nd can) and olive oil are still well-stocked. Bread is expiring today — family finishes the bread at dinner.

## Day 7 — Sunday

1. Morning: kids eat banana bread (2 slices each → 4 slices used). Jordan updates leftover: 4 slices remaining.
2. Kid #1 has yogurt. Down to 1.5 packs.
3. Jordan preps **Chicken Caesar Salad** for dinner. Cook mode → depletion: chicken breast (from Tuesday, still in fridge — check expiry was April 18, system warns it may be expired). Jordan inspects it — it's fine, cooked it thoroughly. Depletes: chicken breast, romaine, caesar dressing, croutons, lemon juice.
4. Leftover salad: Jordan adds **leftover**: "Chicken Caesar salad", 2 portions, fridge, expires Tuesday.
5. Leftover pizza from Friday: still has 2 slices (kids ate 2 during the week). Expires tomorrow. Jordan serves it as kid snack. Marks pizza leftover as **finished**.
6. Jordan opens the app to **plan next week**. Checks inventory status:
   - **Well stocked:** olive oil, spaghetti (half box), crushed tomatoes (1 can), cereal, sugar, sesame oil, soy sauce, caesar dressing, croutons, eggs (10 remaining), lemons
   - **Running low:** yogurt (1.5 packs), garlic (used some for salad)
   - **Out of stock:** ground beef, chicken breast, broccoli, bread, butter, heavy cream, parmesan, milk (opened, about 1/3 left)
   - **Leftovers:** banana bread (4 slices, exp Wed), chicken caesar salad (2 portions, exp Tue)
   - **Expiring soon:** nothing critical
7. Jordan adds next week's recipes to meal plan. The shopping list generates with confidence-aware deltas — shows "you need 2 more cups of flour" instead of the full recipe amount, because the system knows there's flour in the pantry at high confidence.

---

## Feature Coverage Matrix

| Feature | Days Exercised |
|---|---|
| Add item to shopping list (from recipe) | 1, 5 |
| Add item to shopping list (manual) | 1, 3, 5 |
| Remove from shopping list ("I have this") | 1 |
| Remove from shopping list ("skip") | 2 |
| Check off items at store | 2, 6 |
| Put away groceries (set area + expiry) | 2, 6 |
| Cook recipe (depletion confirmation) | 1, 3 |
| Ad-hoc cooking (manual depletion) | 4, 6 |
| Mid-cook out-of-stock discovery | 3 |
| Add leftover | 1, 3, 5, 6 |
| Update leftover portions | 2, 4, 5, 7 |
| Finish leftover | 1, 2, 5, 6, 7 |
| Edit expiry date | 1, 3 |
| Move item between areas | 4 |
| Mark out of stock | 3, 5 |
| Keep-in-stock auto-add to list | 5 |
| View expiring items | 4, 7 |
| View low stock | 7 |
| Expiry warning during cook mode | 7 |
| Shopping list consolidation (shared ingredients) | 1 |
| Confidence-aware shopping list generation | 7 |
| Substitution suggestion | 3 |
| Quick add at store (not on list) | 2 |
| Inventory reconciliation / stock check | 7 |
