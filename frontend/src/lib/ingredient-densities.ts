// Ingredient density database (g/cup)
// 439 ingredients with source attribution
//
// Density = grams per 1 US cup (236.588 mL)
// Used for weight <-> volume conversion via the unit system.
//
// Sources:
//   USDA  = USDA FoodData Central (fdc.nal.usda.gov)
//   KA    = King Arthur Baking Ingredient Weight Chart
//   STD   = Standard physical property (known density of liquid/oil)

export interface DensityEntry {
  /** Grams per 1 US cup */
  density: number;
  /** Source of the density value */
  source: string;
}

export interface DensityMatch {
  density: number;
  matchedKey: string;
  source: string;
}

const USDA = "USDA FoodData Central";
const KA = "King Arthur Baking";
const STD = "Standard measurement";

export const INGREDIENT_DENSITIES: Record<string, DensityEntry> = {
  // Baking
  "breadcrumb (fine)": { density: 108, source: USDA },

  // Beans & Legumes
  "black beans (canned, drained)": { density: 172, source: USDA },
  "black beans (dry)": { density: 194, source: USDA },
  "black lentils": { density: 192, source: USDA },
  "black-eyed peas (dry)": { density: 167, source: USDA },
  "brown lentils": { density: 192, source: USDA },
  "chickpeas (canned, drained)": { density: 164, source: USDA },
  "chickpeas (dry)": { density: 200, source: USDA },
  "edamame (shelled)": { density: 155, source: USDA },
  "green lentils": { density: 192, source: USDA },
  "kidney beans (canned, drained)": { density: 177, source: USDA },
  "kidney beans (dry)": { density: 184, source: USDA },
  "mung beans": { density: 207, source: USDA },
  "pinto beans (canned, drained)": { density: 171, source: USDA },
  "pinto beans (dry)": { density: 193, source: USDA },
  "red lentils": { density: 192, source: USDA },
  "split peas": { density: 196, source: USDA },
  "white beans (canned, drained)": { density: 179, source: USDA },
  "white beans (dry)": { density: 184, source: USDA },

  // Cheeses
  "asiago (grated)": { density: 100, source: USDA },
  "blue cheese (crumbled)": { density: 135, source: USDA },
  "brie": { density: 150, source: USDA },
  "camembert": { density: 150, source: USDA },
  "cheddar (shredded)": { density: 113, source: USDA },
  "colby cheese (shredded)": { density: 113, source: USDA },
  "cotija (crumbled)": { density: 115, source: USDA },
  "feta (crumbled)": { density: 150, source: USDA },
  "goat cheese": { density: 230, source: USDA },
  "halloumi": { density: 150, source: USDA },
  "mascarpone": { density: 227, source: USDA },
  "monterey jack (shredded)": { density: 113, source: USDA },
  "mozzarella (fresh)": { density: 224, source: USDA },
  "mozzarella (shredded)": { density: 112, source: USDA },
  "paneer": { density: 226, source: USDA },
  "parmesan (grated)": { density: 100, source: USDA },
  "parmesan (shredded)": { density: 80, source: USDA },
  "pecorino romano (grated)": { density: 100, source: USDA },
  "provolone (shredded)": { density: 113, source: USDA },
  "queso fresco": { density: 132, source: USDA },
  "swiss cheese (shredded)": { density: 108, source: USDA },

  // Condiments
  "prepared horseradish": { density: 227, source: USDA },
  "sweet pickle relish": { density: 245, source: USDA },

  // Condiments & Sauces
  "anchovy paste": { density: 240, source: USDA },
  "balsamic glaze": { density: 320, source: USDA },
  "bbq sauce": { density: 280, source: USDA },
  "capers": { density: 142, source: USDA },
  "dijon mustard": { density: 256, source: USDA },
  "fish sauce": { density: 272, source: USDA },
  "gochujang": { density: 280, source: USDA },
  "harissa": { density: 240, source: USDA },
  "hoisin sauce": { density: 284, source: USDA },
  "hot sauce": { density: 240, source: USDA },
  "italian dressing": { density: 236, source: USDA },
  "ketchup": { density: 272, source: USDA },
  "mayonnaise": { density: 232, source: USDA },
  "miso paste": { density: 275, source: USDA },
  "olives (sliced)": { density: 135, source: USDA },
  "oyster sauce": { density: 288, source: USDA },
  "pesto": { density: 240, source: USDA },
  "pickles (diced)": { density: 143, source: USDA },
  "ranch dressing": { density: 240, source: USDA },
  "salsa": { density: 240, source: USDA },
  "sambal oelek": { density: 240, source: USDA },
  "sriracha": { density: 266, source: USDA },
  "tamari": { density: 255, source: USDA },
  "teriyaki sauce": { density: 288, source: USDA },
  "whole grain mustard": { density: 250, source: USDA },
  "worcestershire sauce": { density: 272, source: USDA },
  "yellow mustard": { density: 248, source: USDA },

  // Dairy
  "buttermilk": { density: 245, source: USDA },
  "clotted cream": { density: 227, source: USDA },
  "condensed milk": { density: 306, source: USDA },
  "cottage cheese": { density: 226, source: USDA },
  "cream cheese": { density: 232, source: USDA },
  "creme fraiche": { density: 240, source: USDA },
  "crème fraîche": { density: 232, source: USDA },
  "evaporated milk": { density: 252, source: USDA },
  "ghee": { density: 218, source: USDA },
  "greek yogurt": { density: 245, source: USDA },
  "heavy cream": { density: 238, source: USDA },
  "kefir": { density: 243, source: USDA },
  "labneh": { density: 227, source: USDA },
  "milk": { density: 245, source: USDA },
  "ricotta cheese": { density: 246, source: USDA },
  "sour cream": { density: 242, source: USDA },
  "whipped cream": { density: 60, source: USDA },
  "whipped topping": { density: 75, source: USDA },
  "yogurt": { density: 245, source: USDA },

  // Dry Goods
  "active dry yeast": { density: 135, source: KA },
  "agar powder": { density: 128, source: USDA },
  "almond meal": { density: 100, source: KA },
  "arrowroot powder": { density: 128, source: USDA },
  "baking powder": { density: 220, source: KA },
  "baking soda": { density: 288, source: KA },
  "breadcrumbs": { density: 108, source: USDA },
  "buttermilk powder": { density: 120, source: KA },
  "butterscotch chips": { density: 170, source: USDA },
  "cacao nibs": { density: 120, source: USDA },
  "chocolate chips": { density: 170, source: KA },
  "cocoa powder": { density: 86, source: KA },
  "cookie crumbs": { density: 115, source: KA },
  "cornmeal": { density: 163, source: KA },
  "cornstarch": { density: 128, source: KA },
  "couscous": { density: 173, source: USDA },
  "cream of tartar": { density: 150, source: KA },
  "dried cranberries": { density: 120, source: USDA },
  "espresso powder": { density: 85, source: KA },
  "flaxseed meal": { density: 112, source: USDA },
  "gelatin powder": { density: 150, source: USDA },
  "graham cracker crumbs": { density: 100, source: KA },
  "hazelnut flour": { density: 112, source: KA },
  "instant coffee": { density: 75, source: USDA },
  "instant yeast": { density: 150, source: KA },
  "kosher salt": { density: 241, source: KA },
  "malt powder": { density: 108, source: KA },
  "matcha powder": { density: 64, source: USDA },
  "meringue powder": { density: 115, source: KA },
  "milk powder": { density: 120, source: USDA },
  "mini marshmallows": { density: 50, source: USDA },
  "nonpareils": { density: 180, source: KA },
  "nutritional yeast": { density: 60, source: USDA },
  "oat bran": { density: 94, source: USDA },
  "oats": { density: 90, source: KA },
  "panko": { density: 60, source: USDA },
  "peanut butter chips": { density: 170, source: KA },
  "pistachio flour": { density: 100, source: KA },
  "potato starch": { density: 160, source: KA },
  "protein powder": { density: 120, source: USDA },
  "psyllium husk": { density: 84, source: USDA },
  "quinoa": { density: 170, source: USDA },
  "raisins": { density: 165, source: USDA },
  "rice (uncooked)": { density: 185, source: USDA },
  "salt": { density: 288, source: STD },
  "shredded coconut": { density: 93, source: KA },
  "sprinkles": { density: 168, source: KA },
  "tapioca starch": { density: 120, source: KA },
  "unsweetened cocoa": { density: 100, source: KA },
  "vital wheat gluten": { density: 144, source: KA },
  "wheat bran": { density: 58, source: USDA },
  "wheat germ": { density: 115, source: USDA },
  "white chocolate chips": { density: 170, source: KA },
  "xanthan gum": { density: 150, source: KA },

  // Fats & Oils
  "butter": { density: 227, source: USDA },
  "coconut oil": { density: 218, source: STD },
  "extra virgin olive oil": { density: 217, source: STD },
  "lard": { density: 205, source: USDA },
  "margarine": { density: 227, source: USDA },
  "olive oil": { density: 216, source: STD },
  "shortening": { density: 205, source: KA },
  "sunflower oil": { density: 217, source: STD },
  "vegetable oil": { density: 218, source: STD },

  // Flours
  "all-purpose flour": { density: 125, source: KA },
  "almond flour": { density: 96, source: KA },
  "bread flour": { density: 127, source: KA },
  "buckwheat flour": { density: 120, source: KA },
  "cake flour": { density: 114, source: KA },
  "coconut flour": { density: 128, source: KA },
  "oat flour": { density: 104, source: KA },
  "rye flour": { density: 102, source: KA },
  "self-rising flour": { density: 125, source: KA },
  "semolina flour": { density: 167, source: KA },
  "spelt flour": { density: 120, source: KA },
  "whole wheat flour": { density: 120, source: KA },

  // Fruits
  "huckleberries": { density: 145, source: USDA },

  // Grains & Pasta
  "arborio rice": { density: 200, source: USDA },
  "barley": { density: 200, source: USDA },
  "basmati rice": { density: 185, source: USDA },
  "brown rice (uncooked)": { density: 190, source: USDA },
  "bulgur": { density: 140, source: USDA },
  "egg noodles (dry)": { density: 76, source: USDA },
  "farfalle (dry)": { density: 80, source: USDA },
  "farro": { density: 180, source: USDA },
  "freekeh": { density: 160, source: USDA },
  "fusilli (dry)": { density: 100, source: USDA },
  "jasmine rice": { density: 185, source: USDA },
  "lasagna sheets": { density: 60, source: USDA },
  "macaroni (dry)": { density: 105, source: USDA },
  "millet": { density: 200, source: USDA },
  "orzo (dry)": { density: 180, source: USDA },
  "penne (dry)": { density: 100, source: USDA },
  "quick oats": { density: 90, source: KA },
  "ramen noodles (dry)": { density: 50, source: USDA },
  "rice noodles (dry)": { density: 80, source: USDA },
  "spaghetti (dry)": { density: 100, source: USDA },
  "steel cut oats": { density: 140, source: USDA },
  "sushi rice": { density: 200, source: USDA },
  "wheat berries": { density: 192, source: USDA },
  "wild rice": { density: 160, source: USDA },

  // Liquids
  "almond milk": { density: 244, source: STD },
  "apple cider vinegar": { density: 239, source: STD },
  "apple juice": { density: 248, source: USDA },
  "balsamic vinegar": { density: 255, source: STD },
  "beef broth": { density: 240, source: USDA },
  "beer": { density: 238, source: STD },
  "chicken broth": { density: 240, source: USDA },
  "coconut cream": { density: 280, source: USDA },
  "coconut milk": { density: 226, source: USDA },
  "coffee": { density: 236, source: STD },
  "coffee (brewed)": { density: 237, source: STD },
  "cranberry juice": { density: 253, source: USDA },
  "espresso": { density: 237, source: STD },
  "grapefruit juice": { density: 247, source: USDA },
  "half and half": { density: 242, source: USDA },
  "juice": { density: 247, source: USDA },
  "lemon juice": { density: 244, source: USDA },
  "lime juice": { density: 244, source: USDA },
  "oat milk": { density: 244, source: STD },
  "orange juice": { density: 248, source: USDA },
  "pineapple juice": { density: 250, source: USDA },
  "red wine": { density: 236, source: STD },
  "red wine vinegar": { density: 239, source: STD },
  "rice vinegar": { density: 239, source: STD },
  "rice wine": { density: 237, source: STD },
  "sesame oil": { density: 218, source: STD },
  "sherry vinegar": { density: 239, source: STD },
  "soy milk": { density: 243, source: USDA },
  "soy sauce": { density: 255, source: USDA },
  "tea": { density: 236, source: STD },
  "vanilla extract": { density: 208, source: KA },
  "vegetable broth": { density: 240, source: USDA },
  "water": { density: 240, source: STD },
  "white vinegar": { density: 239, source: STD },
  "white wine": { density: 236, source: STD },
  "white wine vinegar": { density: 239, source: STD },
  "wine": { density: 234, source: STD },

  // Nuts & Seeds
  "almond butter": { density: 256, source: USDA },
  "almonds (sliced)": { density: 92, source: USDA },
  "almonds (whole)": { density: 143, source: USDA },
  "brazil nuts": { density: 140, source: USDA },
  "cashew butter": { density: 256, source: USDA },
  "cashews": { density: 137, source: USDA },
  "chia seeds": { density: 168, source: USDA },
  "flax seeds": { density: 168, source: USDA },
  "hazelnuts": { density: 135, source: USDA },
  "hemp seeds": { density: 160, source: USDA },
  "macadamia nuts": { density: 134, source: USDA },
  "peanut butter": { density: 258, source: USDA },
  "peanuts": { density: 146, source: USDA },
  "pecans (chopped)": { density: 109, source: USDA },
  "pine nuts": { density: 136, source: USDA },
  "pistachios": { density: 123, source: USDA },
  "poppy seeds": { density: 145, source: USDA },
  "pumpkin seeds": { density: 129, source: USDA },
  "sesame seeds": { density: 144, source: USDA },
  "sunflower seed butter": { density: 256, source: USDA },
  "sunflower seeds": { density: 140, source: USDA },
  "tahini": { density: 256, source: USDA },
  "walnuts (chopped)": { density: 120, source: USDA },

  // Oils & Fats
  "blended oil": { density: 218, source: STD },
  "canola oil": { density: 218, source: STD },
  "grapeseed oil": { density: 218, source: STD },

  // Produce
  "garlic (minced)": { density: 136, source: USDA },

  // Produce & Purees
  "applesauce": { density: 244, source: USDA },
  "artichoke hearts": { density: 168, source: USDA },
  "arugula": { density: 20, source: USDA },
  "asparagus (pieces)": { density: 134, source: USDA },
  "avocado (mashed)": { density: 230, source: USDA },
  "bamboo shoots": { density: 131, source: USDA },
  "bean sprouts": { density: 104, source: USDA },
  "beets (diced)": { density: 170, source: USDA },
  "bell pepper (diced)": { density: 149, source: USDA },
  "blackberries": { density: 144, source: USDA },
  "blueberries (fresh)": { density: 148, source: USDA },
  "bok choy (chopped)": { density: 70, source: USDA },
  "broccoli florets": { density: 91, source: USDA },
  "butternut squash (diced)": { density: 140, source: USDA },
  "cabbage (shredded)": { density: 89, source: USDA },
  "carrot (diced)": { density: 128, source: USDA },
  "carrot (shredded)": { density: 110, source: USDA },
  "cauliflower florets": { density: 100, source: USDA },
  "celery (diced)": { density: 101, source: USDA },
  "cherries (pitted)": { density: 154, source: USDA },
  "coconut (fresh, shredded)": { density: 80, source: USDA },
  "collard greens (chopped)": { density: 36, source: USDA },
  "corn kernels": { density: 164, source: USDA },
  "cranberries (fresh)": { density: 110, source: USDA },
  "crushed tomatoes": { density: 250, source: USDA },
  "cucumber (diced)": { density: 133, source: USDA },
  "dates (pitted)": { density: 178, source: USDA },
  "diced tomatoes (canned)": { density: 240, source: USDA },
  "dragon fruit (cubed)": { density: 227, source: USDA },
  "dried apricots": { density: 130, source: USDA },
  "dried cherries": { density: 140, source: USDA },
  "dried figs": { density: 149, source: USDA },
  "eggplant (diced)": { density: 82, source: USDA },
  "fennel (sliced)": { density: 87, source: USDA },
  "fresh basil (chopped)": { density: 24, source: USDA },
  "fresh cilantro (chopped)": { density: 16, source: USDA },
  "fresh dill (chopped)": { density: 8.5, source: USDA },
  "fresh garlic (minced)": { density: 136, source: USDA },
  "fresh ginger (minced)": { density: 96, source: USDA },
  "fresh mint (chopped)": { density: 48, source: USDA },
  "fresh parsley (chopped)": { density: 60, source: USDA },
  "grapes": { density: 151, source: USDA },
  "green beans": { density: 110, source: USDA },
  "green onion (sliced)": { density: 100, source: USDA },
  "green peas": { density: 145, source: USDA },
  "hearts of palm": { density: 146, source: USDA },
  "jackfruit": { density: 165, source: USDA },
  "jalapeño (diced)": { density: 90, source: USDA },
  "kale (chopped)": { density: 67, source: USDA },
  "kiwi (sliced)": { density: 180, source: USDA },
  "leek (sliced)": { density: 89, source: USDA },
  "lettuce (shredded)": { density: 47, source: USDA },
  "lychee": { density: 190, source: USDA },
  "mango (diced)": { density: 165, source: USDA },
  "mashed banana": { density: 225, source: USDA },
  "mushrooms (sliced)": { density: 70, source: USDA },
  "nectarine (sliced)": { density: 143, source: USDA },
  "onion (diced)": { density: 160, source: USDA },
  "papaya (diced)": { density: 145, source: USDA },
  "parsnip (diced)": { density: 133, source: USDA },
  "passion fruit pulp": { density: 236, source: USDA },
  "peach (sliced)": { density: 154, source: USDA },
  "pineapple (chunks)": { density: 165, source: USDA },
  "plantain (sliced)": { density: 148, source: USDA },
  "plum (sliced)": { density: 165, source: USDA },
  "pomegranate seeds": { density: 174, source: USDA },
  "potato (diced)": { density: 150, source: USDA },
  "potato (mashed)": { density: 210, source: USDA },
  "prunes": { density: 174, source: USDA },
  "pumpkin puree": { density: 245, source: USDA },
  "radish (sliced)": { density: 116, source: USDA },
  "raspberries (fresh)": { density: 123, source: USDA },
  "shallot (diced)": { density: 160, source: USDA },
  "snap peas": { density: 98, source: USDA },
  "spinach (fresh, packed)": { density: 30, source: USDA },
  "spinach (frozen, thawed)": { density: 180, source: USDA },
  "strawberries (sliced)": { density: 166, source: USDA },
  "sun-dried tomatoes": { density: 110, source: USDA },
  "sweet potato (mashed)": { density: 255, source: USDA },
  "swiss chard (chopped)": { density: 36, source: USDA },
  "tomato (fresh, diced)": { density: 180, source: USDA },
  "tomato paste": { density: 262, source: USDA },
  "tomato sauce": { density: 245, source: USDA },
  "turnip (diced)": { density: 130, source: USDA },
  "water chestnuts": { density: 124, source: USDA },
  "watercress": { density: 34, source: USDA },
  "zucchini (shredded)": { density: 124, source: USDA },

  // Proteins & Eggs
  "bacon (cooked, crumbled)": { density: 105, source: USDA },
  "chicken (shredded)": { density: 140, source: USDA },
  "chicken breast (diced)": { density: 140, source: USDA },
  "chorizo (cooked, crumbled)": { density: 150, source: USDA },
  "crab meat": { density: 135, source: USDA },
  "egg (whole, large)": { density: 243, source: USDA },
  "egg white": { density: 243, source: USDA },
  "egg yolk": { density: 243, source: USDA },
  "ground beef": { density: 226, source: USDA },
  "ground chicken": { density: 226, source: USDA },
  "ground pork": { density: 226, source: USDA },
  "ground turkey": { density: 226, source: USDA },
  "ham (diced)": { density: 150, source: USDA },
  "pepperoni (sliced)": { density: 80, source: USDA },
  "salmon (canned)": { density: 154, source: USDA },
  "sardines (canned)": { density: 149, source: USDA },
  "sausage (cooked, sliced)": { density: 140, source: USDA },
  "seitan": { density: 144, source: USDA },
  "shrimp (cooked)": { density: 145, source: USDA },
  "tempeh": { density: 166, source: USDA },
  "tofu (firm)": { density: 252, source: USDA },
  "tofu (silken)": { density: 240, source: USDA },
  "tuna (canned, drained)": { density: 154, source: USDA },

  // Spices
  "ancho powder": { density: 85, source: USDA },
  "chili rub": { density: 120, source: USDA },
  "chili spice blend": { density: 120, source: USDA },
  "dehydrated garlic": { density: 120, source: USDA },
  "granulated garlic": { density: 152, source: USDA },

  // Spices & Herbs
  "allspice (ground)": { density: 96, source: USDA },
  "apple pie spice": { density: 104, source: USDA },
  "basil (dried)": { density: 24, source: USDA },
  "bay leaves": { density: 16, source: USDA },
  "black pepper (ground)": { density: 116, source: USDA },
  "cajun seasoning": { density: 128, source: USDA },
  "caraway seeds": { density: 100, source: USDA },
  "cardamom (ground)": { density: 100, source: USDA },
  "cayenne pepper": { density: 90, source: USDA },
  "celery seed": { density: 112, source: USDA },
  "chili powder": { density: 128, source: USDA },
  "chinese five spice": { density: 96, source: USDA },
  "cilantro (dried)": { density: 16, source: USDA },
  "cinnamon (ground)": { density: 125, source: USDA },
  "cloves (ground)": { density: 112, source: USDA },
  "coriander (ground)": { density: 80, source: USDA },
  "coriander seeds": { density: 96, source: USDA },
  "cumin (ground)": { density: 104, source: USDA },
  "cumin seeds": { density: 112, source: USDA },
  "curry powder": { density: 112, source: USDA },
  "dill (dried)": { density: 16, source: USDA },
  "fennel seeds": { density: 96, source: USDA },
  "garam masala": { density: 100, source: USDA },
  "garlic powder": { density: 152, source: USDA },
  "ginger (ground)": { density: 96, source: USDA },
  "ground cinnamon": { density: 132, source: USDA },
  "ground cumin": { density: 112, source: USDA },
  "ground ginger": { density: 120, source: USDA },
  "ground nutmeg": { density: 112, source: USDA },
  "ground pepper": { density: 112, source: USDA },
  "ground turmeric": { density: 120, source: USDA },
  "herbes de provence": { density: 28, source: USDA },
  "italian seasoning": { density: 24, source: USDA },
  "mint (dried)": { density: 16, source: USDA },
  "mustard powder": { density: 112, source: USDA },
  "nutmeg (ground)": { density: 112, source: USDA },
  "old bay seasoning": { density: 128, source: USDA },
  "onion powder": { density: 112, source: USDA },
  "oregano (dried)": { density: 28, source: USDA },
  "paprika": { density: 109, source: USDA },
  "parsley (dried)": { density: 16, source: USDA },
  "pumpkin pie spice": { density: 104, source: USDA },
  "red pepper flakes": { density: 80, source: USDA },
  "rosemary (dried)": { density: 32, source: USDA },
  "saffron": { density: 2, source: USDA },
  "sage (dried)": { density: 16, source: USDA },
  "sea salt": { density: 288, source: STD },
  "smoked paprika": { density: 109, source: USDA },
  "star anise": { density: 56, source: USDA },
  "sumac": { density: 144, source: USDA },
  "table salt": { density: 288, source: STD },
  "taco seasoning": { density: 128, source: USDA },
  "thyme (dried)": { density: 28, source: USDA },
  "turmeric (ground)": { density: 136, source: USDA },
  "vanilla bean powder": { density: 112, source: KA },
  "white pepper": { density: 116, source: USDA },
  "za'atar": { density: 72, source: USDA },

  // Stocks & Broths
  "beef base": { density: 280, source: USDA },
  "beef stock": { density: 240, source: USDA },
  "chicken stock": { density: 240, source: USDA },
  "vegetable stock": { density: 240, source: USDA },

  // Sugars & Sweeteners
  "agave nectar": { density: 336, source: USDA },
  "brown sugar (packed)": { density: 220, source: KA },
  "coconut sugar": { density: 180, source: USDA },
  "corn syrup": { density: 340, source: USDA },
  "granulated sugar": { density: 200, source: KA },
  "honey": { density: 340, source: USDA },
  "maple syrup": { density: 322, source: USDA },
  "molasses": { density: 328, source: USDA },
  "powdered sugar": { density: 120, source: KA },
  "turbinado sugar": { density: 200, source: KA },

  // Vinegars
  "champagne vinegar": { density: 239, source: STD },
};

/**
 * Look up the density (g/cup) for an ingredient name.
 * Matching priority: exact > item name contains key (longest) > key contains item name
 * Returns null if no match found.
 */
export function lookupDensity(itemName: string): number | null {
  const result = lookupDensityWithSource(itemName);
  return result ? result.density : null;
}

export function lookupDensityWithSource(itemName: string): DensityMatch | null {
  const name = itemName.toLowerCase().trim();

  // 1. Exact match
  if (INGREDIENT_DENSITIES[name] !== undefined) {
    const entry = INGREDIENT_DENSITIES[name];
    return { density: entry.density, matchedKey: name, source: entry.source };
  }

  // 2. Item name contains a key (longest match wins)
  let bestMatch: string | null = null;
  let bestLength = 0;
  for (const key of Object.keys(INGREDIENT_DENSITIES)) {
    if (name.includes(key) && key.length > bestLength) {
      bestMatch = key;
      bestLength = key.length;
    }
  }
  if (bestMatch) {
    const entry = INGREDIENT_DENSITIES[bestMatch];
    return { density: entry.density, matchedKey: bestMatch, source: entry.source };
  }

  // 3. Key contains item name (only if item name is at least 3 chars)
  if (name.length >= 3) {
    for (const [key, entry] of Object.entries(INGREDIENT_DENSITIES)) {
      if (key.includes(name)) {
        return { density: entry.density, matchedKey: key, source: entry.source };
      }
    }
  }

  return null;
}
