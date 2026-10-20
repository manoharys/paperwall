// Copy for the generated templates, written for Paperwall and dedicated to
// the public domain (CC0) with the rest of the templates. Each category picks
// its formats, layouts, palettes and font pairings; each entry is one piece
// of content that gets laid out several ways.

export const FORMATS = {
  post: { w: 1080, h: 1080, label: 'Square post' },
  portrait: { w: 1080, h: 1350, label: 'Portrait post' },
  story: { w: 1080, h: 1920, label: 'Story' },
  thumb: { w: 1280, h: 720, label: 'Video thumbnail' },
  banner: { w: 1500, h: 500, label: 'Web banner' },
  slides: { w: 1920, h: 1080, label: 'Presentation' },
  a4: { w: 2480, h: 3508, label: 'A4' },
  landscape: { w: 3508, h: 2480, label: 'A4 landscape' },
  flyer: { w: 1748, h: 2480, label: 'Flyer (A5)' },
  card: { w: 1050, h: 600, label: 'Business card' },
  invite: { w: 1500, h: 2100, label: 'Invitation' },
  logo: { w: 500, h: 500, label: 'Logo' },
  pin: { w: 1000, h: 1500, label: 'Pin' },
};

export const CATEGORIES = [
  {
    name: 'Sales', formats: ['post', 'story', 'portrait'], layouts: ['badge', 'poster', 'marker'],
    palettes: ['coral', 'lemon', 'electric', 'paper', 'sunset'], pairs: ['Impact', 'Bold poster', 'Headline'],
    tags: 'sale discount offer deal shop promo',
    items: [
      { name: 'Flash sale', kicker: '48 hours only', title: 'Flash Sale', offer: '40% OFF', sub: 'Everything in store and online', cta: 'Shop the sale', info: 'Ends Sunday at midnight', icon: 'bolt' },
      { name: 'Season clearance', kicker: 'End of season', title: 'Clearance Event', offer: 'UP TO 70%', sub: 'Last chance on this season’s favorites', cta: 'Grab a bargain', info: 'In store · while stocks last', icon: 'tag' },
      { name: 'Buy one get one', kicker: 'This week', title: 'Buy One, Get One Free', offer: 'BOGO', sub: 'Mix and match across the whole range', cta: 'Use code TWOFOR', info: 'Online and in all our shops', icon: 'gift' },
    ],
  },
  {
    name: 'Announcements', formats: ['post', 'story', 'portrait'], layouts: ['marker', 'center', 'minimal'],
    palettes: ['sky', 'midnight', 'paper', 'lavender', 'mono'], pairs: ['Startup', 'Modern', 'Clean'],
    tags: 'announcement news update big news launch',
    items: [
      { name: 'Big news', kicker: 'Announcement', title: 'We have big news to share', sub: 'Something we have been working on all year is finally here', cta: 'Read more', info: 'Link in bio', icon: 'megaphone' },
      { name: 'We moved', kicker: 'New address', title: 'We’ve moved!', sub: 'Come and see us at our bright new space on the corner of Oak and Fifth', cta: 'Visit us', info: 'Open Monday to Saturday', icon: 'pin' },
      { name: 'New hours', kicker: 'Heads up', title: 'Our new opening hours', sub: 'Monday to Friday 8–6 · Saturday 9–4 · Sunday closed', info: 'Thank you for your patience', icon: 'clock' },
    ],
  },
  {
    name: 'Grand opening', formats: ['post', 'portrait', 'flyer'], layouts: ['center', 'corner', 'poster'],
    palettes: ['sunset', 'paper', 'teal', 'coral', 'navy'], pairs: ['Bold poster', 'Retro', 'Magazine'],
    tags: 'grand opening now open store shop launch ribbon',
    items: [
      { name: 'Now open', kicker: 'Doors open Saturday', title: 'Grand Opening', sub: 'Live music, free samples and a warm welcome', cta: 'Join the party', info: '12 Market Street · from 10 am', icon: 'lu-store' },
      { name: 'Opening day', kicker: 'You’re invited', title: 'Opening Day Celebration', sub: 'The first 50 visitors get a free tote bag', cta: 'See you there', info: 'Friday, May 9 · 9 am – 7 pm', icon: 'lu-party-popper' },
      { name: 'Soft launch', kicker: 'Neighborhood preview', title: 'Come Say Hello', sub: 'Our kitchen is open for a week of preview nights', cta: 'Book a table', info: '4 Harbor Lane · nightly from 5 pm', icon: 'lu-utensils' },
    ],
  },
  {
    name: 'Quotes', formats: ['post', 'portrait', 'story'], layouts: ['quote', 'card', 'minimal'],
    palettes: ['midnight', 'sage', 'burgundy', 'paper', 'navy', 'blush'], pairs: ['Classic', 'Editorial', 'Bookish', 'Elegant'],
    tags: 'quote inspiration motivation words wisdom',
    items: [
      { name: 'Begin anyway', kicker: 'Daily reminder', title: 'Start where you are. Use what you have. Do what you can.', sub: 'Pass it on', icon: 'quote', deco: 'leaves' },
      { name: 'Small steps', kicker: 'Monday motivation', title: 'Small steps every day add up to big changes.', sub: 'Keep going', icon: 'quote', deco: 'sparkle-trio' },
      { name: 'Be kind', kicker: 'Words to live by', title: 'In a world where you can be anything, be kind.', sub: 'Share with someone today', icon: 'heart', deco: 'flower' },
    ],
  },
  {
    name: 'Birthday', formats: ['invite', 'post', 'story'], layouts: ['frame', 'center', 'card'],
    palettes: ['blush', 'lavender', 'lemon', 'ocean', 'coral'], pairs: ['Playful', 'Script', 'Calligraphy', 'Friendly'],
    tags: 'birthday party invite celebrate kids cake',
    items: [
      { name: 'Birthday party', kicker: 'You’re invited', title: 'Maya Turns Seven', sub: 'Games, cake and a bouncy castle', info: 'Saturday, June 14 · 3 pm', cta: 'Reply to Sam by June 7', icon: 'cake', deco: 'confetti-burst', script: 'Pacifico' },
      { name: 'Fortieth birthday', kicker: 'Join us to celebrate', title: 'Fabulous at Forty', sub: 'An evening of good food and better company', info: 'The Rooftop Bar · Friday 7 pm', cta: 'Dress code: something sparkly', icon: 'lu-party-popper', deco: 'sparkle-trio', script: 'Great Vibes' },
      { name: 'Happy birthday', kicker: 'Happy birthday', title: 'Wishing you a year full of joy', sub: 'Hope your day is as wonderful as you are', info: 'With love from all of us', icon: 'gift', deco: 'heart', script: 'Dancing Script' },
    ],
  },
  {
    name: 'Wedding', formats: ['invite', 'post', 'portrait'], layouts: ['frame', 'center', 'minimal'],
    palettes: ['burgundy', 'sage', 'paper', 'navy', 'blush'], pairs: ['Wedding', 'Elegant', 'Luxury', 'Calligraphy'],
    tags: 'wedding marriage invite save the date engagement',
    items: [
      { name: 'Wedding invitation', kicker: 'Together with their families', title: 'Ava & Noah', sub: 'invite you to celebrate their marriage', info: 'Saturday, the twelfth of September · 4 pm', cta: 'Rosewood Gardens, Lakeview', icon: 'heart', deco: 'leaves', script: 'Great Vibes' },
      { name: 'Save the date', kicker: 'Save the date', title: 'Lena & Omar', sub: 'are getting married', info: '06 · 21 · 2027', cta: 'Formal invitation to follow', icon: 'calendar', deco: 'flower', script: 'Dancing Script' },
      { name: 'Engagement party', kicker: 'Please join us for', title: 'An Engagement Celebration', sub: 'in honor of Priya and James', info: 'Sunday, March 8 · 2 pm', cta: 'The Old Mill, Riverside', icon: 'lu-gem', deco: 'daisy' },
    ],
  },
  {
    name: 'Baby shower', formats: ['invite', 'post', 'story'], layouts: ['frame', 'card', 'center'],
    palettes: ['mint', 'blush', 'ocean', 'lemon', 'lavender'], pairs: ['Playful', 'Handmade', 'Script', 'Friendly'],
    tags: 'baby shower newborn gender reveal welcome baby',
    items: [
      { name: 'Baby shower', kicker: 'Please join us for a', title: 'Baby Shower', sub: 'honoring mom-to-be Grace', info: 'Sunday, April 20 · 1 pm', cta: 'Hosted by Ella · 22 Birch Road', icon: 'lu-baby', deco: 'cloud', script: 'Pacifico' },
      { name: 'Welcome baby', kicker: 'Hello world', title: 'Welcome, Little Leo', sub: 'Born March 3 · 7 lb 2 oz', info: 'Thank you for all the love', icon: 'heart', deco: 'sparkle-trio', script: 'Dancing Script' },
      { name: 'Gender reveal', kicker: 'Boy or girl?', title: 'Gender Reveal Party', sub: 'Come guess with us — cake will tell!', info: 'Saturday, May 17 · 4 pm', cta: 'Wear pink or blue', icon: 'gift', deco: 'confetti-burst' },
    ],
  },
  {
    name: 'Events', formats: ['portrait', 'story', 'flyer'], layouts: ['poster', 'corner', 'marker'],
    palettes: ['electric', 'sunset', 'midnight', 'coral', 'teal'], pairs: ['Bold poster', 'Impact', 'Tech', 'Retro'],
    tags: 'event concert festival gig night market fair',
    items: [
      { name: 'Night market', kicker: 'Food · music · makers', title: 'Night Market', sub: 'Forty stalls, two stages and a lot of dumplings', info: 'Fri, Aug 22 · 6 pm · Riverside Park', cta: 'Free entry', icon: 'moon' },
      { name: 'Summer festival', kicker: 'Three days of sun', title: 'Summer Sound Festival', sub: 'Twenty bands on the beach', info: 'July 18–20 · North Shore', cta: 'Tickets on sale now', icon: 'music' },
      { name: 'Art fair', kicker: 'Local makers', title: 'Spring Art Fair', sub: 'Paintings, ceramics, prints and workshops for kids', info: 'Sat & Sun · Town Hall', cta: 'Everyone welcome', icon: 'lu-palette' },
    ],
  },
  {
    name: 'Webinars', formats: ['slides', 'post', 'thumb'], layouts: ['split', 'minimal', 'corner'],
    palettes: ['sky', 'lavender', 'midnight', 'ocean', 'mono'], pairs: ['Startup', 'Clean', 'Modern', 'Tech'],
    tags: 'webinar online event talk live workshop zoom',
    items: [
      { name: 'Live workshop', kicker: 'Free live workshop', title: 'Design your first poster in 30 minutes', sub: 'No experience needed. Bring your ideas.', info: 'Thursday, 5 pm UTC · Online', cta: 'Save my seat', icon: 'users' },
      { name: 'Expert panel', kicker: 'Panel discussion', title: 'The Future of Remote Work', sub: 'Three founders on hiring, culture and calm', info: 'May 14 · 6 pm CET · Live', cta: 'Register free', icon: 'lu-laptop' },
      { name: 'Masterclass', kicker: 'Masterclass', title: 'Grow Your Small Business Online', sub: 'Practical steps you can take this week', info: 'Tuesday · 12 noon · 45 minutes', cta: 'Join live', icon: 'rocket' },
    ],
  },
  {
    name: 'Hiring', formats: ['post', 'portrait', 'story'], layouts: ['marker', 'list', 'split'],
    palettes: ['sky', 'mint', 'electric', 'paper', 'lavender'], pairs: ['Startup', 'Modern', 'Clean'],
    tags: 'hiring job careers vacancy recruit join our team',
    items: [
      { name: 'We’re hiring', kicker: 'Join our team', title: 'We’re Hiring a Product Designer', sub: 'Remote friendly · full time', items: ['Shape a tool used by thousands', 'Four-day weeks in summer', 'Learning budget every year'], cta: 'Apply by June 30', info: 'careers@example.com', icon: 'briefcase' },
      { name: 'Join the crew', kicker: 'Now hiring', title: 'Baristas Wanted', sub: 'Weekend and evening shifts available', items: ['Free coffee, obviously', 'Flexible hours', 'Friendly team'], cta: 'Ask at the counter', info: 'Bean & Leaf Café', icon: 'coffee' },
      { name: 'Internships', kicker: 'Summer internships', title: 'Start Your Career With Us', sub: 'Paid placements in design, data and marketing', items: ['Real projects from day one', 'A mentor of your own', 'Open to all students'], cta: 'Apply online', info: 'Applications close April 1', icon: 'graduation' },
    ],
  },
  {
    name: 'Real estate', formats: ['portrait', 'post', 'flyer'], layouts: ['split', 'card', 'list'],
    palettes: ['navy', 'sage', 'terracotta', 'ocean', 'mono'], pairs: ['Elegant', 'Modern', 'Editorial'],
    tags: 'real estate house home property open house listing sold',
    items: [
      { name: 'Open house', kicker: 'Open house', title: 'Sunday, 1–4 pm', sub: '88 Willow Lane', items: ['3 bedrooms · 2 bathrooms', 'South-facing garden', 'Ten minutes from the station'], info: 'Call Dana on 555 0142', cta: 'Book a viewing', icon: 'home' },
      { name: 'Just listed', kicker: 'Just listed', title: 'Light-Filled Family Home', sub: '$640,000 · 4 bed · 3 bath', items: ['Open-plan kitchen', 'Double garage', 'Close to schools'], info: 'Harbor Realty', cta: 'View the listing', icon: 'lu-key-round' },
      { name: 'Sold', kicker: 'Another one', title: 'Just Sold!', sub: 'Thinking of selling? Ask us for a free valuation.', items: ['Local experts', 'Fair, flat fees', 'Sold in 12 days'], info: 'Harbor Realty · 555 0199', cta: 'Get a free valuation', icon: 'trophy' },
    ],
  },
  {
    name: 'Restaurant', formats: ['post', 'story', 'portrait'], layouts: ['corner', 'badge', 'center'],
    palettes: ['terracotta', 'forest', 'lemon', 'burgundy', 'coral'], pairs: ['Retro', 'Magazine', 'Bold poster', 'Classic'],
    tags: 'restaurant food menu dinner special pizza burger',
    items: [
      { name: 'Taco Tuesday', kicker: 'Every Tuesday', title: 'Taco Tuesday', offer: '2 FOR $5', sub: 'Fresh tortillas, slow-cooked fillings', cta: 'Walk in or order ahead', info: 'La Cocina · Main Street', icon: 'lu-utensils' },
      { name: 'Pizza night', kicker: 'Family night', title: 'Pizza Night', offer: 'KIDS EAT FREE', sub: 'Wood-fired pizzas from 5 pm', cta: 'Book a table', info: 'Forno · 7 Bridge Road', icon: 'pizza' },
      { name: 'Brunch', kicker: 'Weekends', title: 'Bottomless Brunch', offer: '$25', sub: 'Pancakes, eggs your way and fresh juice', cta: 'Reserve now', info: 'Sat & Sun · 9 am – 2 pm', icon: 'coffee' },
    ],
  },
  {
    name: 'Menus', formats: ['a4', 'flyer', 'portrait'], layouts: ['menu', 'menu', 'list'],
    palettes: ['paper', 'forest', 'burgundy', 'terracotta', 'navy'], pairs: ['Classic', 'Elegant', 'Magazine', 'Bookish'],
    tags: 'menu restaurant cafe drinks food price list',
    items: [
      { name: 'Café menu', kicker: 'Served all day', title: 'Café Menu', items: ['Espresso | 2.80', 'Flat white | 3.60', 'Chai latte | 3.90', 'Fresh orange juice | 4.20', 'Almond croissant | 3.50', 'Avocado toast | 8.50', 'Granola bowl | 7.20', 'Grilled cheese | 7.90'], info: 'Oat and soy milk at no extra cost', icon: 'coffee' },
      { name: 'Dinner menu', kicker: 'Tonight', title: 'Dinner', items: ['Burrata, peach, basil | 12', 'Charred broccoli, chili | 9', 'Roast chicken, herbs | 22', 'Mushroom risotto | 19', 'Grilled sea bass | 26', 'Chocolate tart | 8', 'Lemon posset | 7'], info: 'Please tell us about any allergies', icon: 'lu-utensils' },
      { name: 'Cocktail menu', kicker: 'The bar', title: 'Cocktails', items: ['Garden spritz | 11', 'Smoked old fashioned | 13', 'Passion fruit sour | 12', 'Espresso martini | 12', 'Cucumber cooler (no alcohol) | 7', 'Ginger fizz (no alcohol) | 7'], info: 'Happy hour 5–7 pm', icon: 'lu-wine' },
    ],
  },
  {
    name: 'Cafe', formats: ['post', 'story', 'portrait'], layouts: ['center', 'corner', 'badge'],
    palettes: ['terracotta', 'paper', 'sage', 'forest', 'lemon'], pairs: ['Handmade', 'Retro', 'Friendly', 'Notebook'],
    tags: 'cafe coffee bakery tea latte pastry',
    items: [
      { name: 'New seasonal latte', kicker: 'Back for autumn', title: 'Maple Spice Latte', offer: 'NEW', sub: 'Warm spices, real maple, your choice of milk', cta: 'Try it today', info: 'Bean & Leaf Café', icon: 'coffee', deco: 'leaves' },
      { name: 'Fresh bakes', kicker: 'Out of the oven', title: 'Fresh Every Morning', offer: 'FROM 7 AM', sub: 'Sourdough, croissants and cinnamon buns', cta: 'Come early', info: 'Little Crumb Bakery', icon: 'lu-croissant', deco: 'sun' },
      { name: 'Loyalty card', kicker: 'Loyalty club', title: 'Your Tenth Coffee Is On Us', offer: 'FREE', sub: 'Ask for a stamp card at the counter', cta: 'Start collecting', info: 'Every coffee counts', icon: 'heart', deco: 'sparkle-trio' },
    ],
  },
  {
    name: 'Fitness', formats: ['post', 'story', 'thumb'], layouts: ['poster', 'marker', 'split'],
    palettes: ['electric', 'coral', 'midnight', 'sky', 'teal'], pairs: ['Impact', 'Bold poster', 'Tech'],
    tags: 'fitness gym workout training yoga health sport',
    items: [
      { name: 'Free trial', kicker: 'New members', title: 'Your First Week Free', sub: 'Classes, weights and a coach to get you started', cta: 'Claim your pass', info: 'Iron Yard Gym · open 24/7', icon: 'dumbbell' },
      { name: 'Yoga class', kicker: 'Every Sunday', title: 'Sunrise Yoga in the Park', sub: 'All levels welcome — bring a mat', cta: 'Free to join', info: '7 am · Rose Garden lawn', icon: 'sun' },
      { name: '30-day challenge', kicker: 'Starts Monday', title: '30-Day Strength Challenge', sub: 'Twenty minutes a day. No equipment.', cta: 'Sign up free', info: '#StrongIn30', icon: 'flame' },
    ],
  },
  {
    name: 'Beauty', formats: ['post', 'portrait', 'story'], layouts: ['card', 'minimal', 'frame'],
    palettes: ['blush', 'burgundy', 'paper', 'lavender', 'sage'], pairs: ['Elegant', 'Luxury', 'Editorial', 'Classic'],
    tags: 'beauty salon spa hair nails skincare makeup',
    items: [
      { name: 'Spa day', kicker: 'Treat yourself', title: 'The Spa Day Package', sub: 'Massage, facial and afternoon tea', info: 'Lotus Spa · book online', cta: 'Gift cards available', icon: 'flower', deco: 'flower' },
      { name: 'New salon', kicker: 'Now booking', title: 'Fresh Cuts & Color', sub: '20% off your first visit', info: 'Studio Nine Hair · 555 0177', cta: 'Book your chair', icon: 'lu-scissors', deco: 'sparkle-trio' },
      { name: 'Skincare', kicker: 'Glow guide', title: 'Simple Skin, Every Day', sub: 'Cleanse · Treat · Moisturize · Protect', info: 'Your skin will thank you', icon: 'sun', deco: 'daisy' },
    ],
  },
  {
    name: 'Fashion', formats: ['portrait', 'story', 'post'], layouts: ['minimal', 'poster', 'marker'],
    palettes: ['mono', 'electric', 'burgundy', 'terracotta', 'midnight'], pairs: ['Magazine', 'Editorial', 'Luxury', 'Impact'],
    tags: 'fashion clothing style collection lookbook boutique',
    items: [
      { name: 'New collection', kicker: 'Autumn / Winter', title: 'The New Collection', sub: 'Soft layers, warm tones, made to last', cta: 'Shop the lookbook', info: 'In stores now', icon: 'lu-shirt' },
      { name: 'Pop-up shop', kicker: 'Two days only', title: 'Vintage Pop-Up', sub: 'Hand-picked denim, knits and leather', cta: 'Cash or card', info: 'Sat & Sun · The Warehouse', icon: 'bag' },
      { name: 'Style tip', kicker: 'Style notes', title: 'Three pieces, ten outfits', sub: 'How to build a capsule wardrobe', cta: 'Read the guide', info: 'New post on the blog', icon: 'sparkle' },
    ],
  },
  {
    name: 'Travel', formats: ['post', 'portrait', 'story'], layouts: ['corner', 'split', 'poster'],
    palettes: ['ocean', 'teal', 'sunset', 'lemon', 'sky'], pairs: ['Retro', 'Bold poster', 'Modern', 'Handmade'],
    tags: 'travel trip holiday vacation tour adventure beach',
    items: [
      { name: 'Island escape', kicker: 'Seven nights from $899', title: 'Island Escape', sub: 'Flights, hotel and breakfast included', cta: 'Book by Friday', info: 'Sunway Travel', icon: 'plane' },
      { name: 'Road trip', kicker: 'Weekend plans', title: 'The Great Coast Road Trip', sub: 'Five towns, three beaches, one playlist', cta: 'See the route', info: 'Guide on the blog', icon: 'car' },
      { name: 'Mountain retreat', kicker: 'Unplug', title: 'Mountain Cabin Retreat', sub: 'Hikes by day, fires by night', cta: 'Check dates', info: 'Pine Ridge Lodge', icon: 'lu-mountain' },
    ],
  },
  {
    name: 'Education', formats: ['post', 'slides', 'flyer'], layouts: ['list', 'split', 'center'],
    palettes: ['sky', 'lemon', 'mint', 'lavender', 'paper'], pairs: ['Friendly', 'Playful', 'Notebook', 'Clean'],
    tags: 'education school class course learning study kids teacher',
    items: [
      { name: 'Enroll now', kicker: 'Enrollment open', title: 'After-School Coding Club', sub: 'Ages 9–14 · Wednesdays', items: ['Build games and websites', 'Small groups', 'Laptops provided'], cta: 'Sign up today', info: 'Westside Library', icon: 'lu-laptop' },
      { name: 'Study tips', kicker: 'Exam season', title: 'Five Study Tips That Work', items: ['Study in 25-minute sprints', 'Teach it to a friend', 'Test yourself, don’t reread', 'Sleep before the exam', 'Start a week early'], cta: 'Save this post', icon: 'book' },
      { name: 'Back to school', kicker: 'Welcome back', title: 'Back to School Night', sub: 'Meet the teachers and tour the classrooms', items: ['Tours from 6 pm', 'Snacks in the hall', 'Book fair'], info: 'Thursday, Sept 4', cta: 'All families welcome', icon: 'graduation' },
    ],
  },
  {
    name: 'Technology', formats: ['post', 'slides', 'thumb'], layouts: ['split', 'minimal', 'corner'],
    palettes: ['midnight', 'electric', 'sky', 'teal', 'mono'], pairs: ['Tech', 'Startup', 'Clean'],
    tags: 'tech product launch app software startup saas',
    items: [
      { name: 'App launch', kicker: 'Now on all devices', title: 'Meet Notely 2.0', sub: 'Faster, offline and free to start', cta: 'Download now', info: 'notely.example', icon: 'rocket' },
      { name: 'New feature', kicker: 'New feature', title: 'Dark mode is here', sub: 'Easy on the eyes, day or night', cta: 'Update the app', info: 'Version 4.2', icon: 'moon' },
      { name: 'Beta invite', kicker: 'Private beta', title: 'Be the First to Try It', sub: 'Join 2,000 early testers shaping the product', cta: 'Request an invite', info: 'Limited spots', icon: 'lu-flask-conical' },
    ],
  },
  {
    name: 'Podcast', formats: ['post', 'thumb', 'story'], layouts: ['poster', 'center', 'corner'],
    palettes: ['sunset', 'electric', 'navy', 'coral', 'midnight'], pairs: ['Bold poster', 'Retro', 'Impact', 'Headline'],
    tags: 'podcast episode audio show interview listen',
    items: [
      { name: 'New episode', kicker: 'Episode 42', title: 'How to Start Anything', sub: 'With guest Rosa Lin, founder of Field Notes', cta: 'Listen now', info: 'Wherever you get your podcasts', icon: 'mic' },
      { name: 'Show cover', kicker: 'A weekly show', title: 'Small Talk, Big Ideas', sub: 'Conversations with curious people', cta: 'New episodes every Monday', info: 'Hosted by Jo & Kai', icon: 'lu-headphones' },
      { name: 'Live recording', kicker: 'Live recording', title: 'Join Us in the Studio', sub: 'Watch the show being made and ask questions', cta: 'Free tickets', info: 'Oct 3 · 7 pm · Studio 4', icon: 'lu-radio' },
    ],
  },
  {
    name: 'YouTube', formats: ['thumb'], layouts: ['marker', 'poster', 'split'],
    palettes: ['electric', 'coral', 'lemon', 'sky', 'sunset', 'midnight'], pairs: ['Impact', 'Bold poster', 'Headline', 'Playful'],
    tags: 'youtube thumbnail video vlog tutorial',
    items: [
      { name: 'Tutorial thumbnail', kicker: 'Beginner friendly', title: 'I Learned to Draw in 30 Days', cta: 'Day 1 vs day 30', icon: 'pencil' },
      { name: 'Recipe thumbnail', kicker: 'Only 3 ingredients', title: 'The Easiest Bread Ever', cta: 'No kneading', icon: 'lu-chef-hat' },
      { name: 'Vlog thumbnail', kicker: 'Vlog', title: 'A Week Living in Tokyo', cta: 'What it really costs', icon: 'camera' },
    ],
  },
  {
    name: 'Tips & lists', formats: ['portrait', 'post', 'story'], layouts: ['list', 'list', 'marker'],
    palettes: ['paper', 'mint', 'sky', 'lavender', 'lemon'], pairs: ['Friendly', 'Clean', 'Startup', 'Notebook'],
    tags: 'tips list listicle how to guide steps carousel',
    items: [
      { name: 'Productivity tips', kicker: 'Save for later', title: 'Five Ways to Focus Better', items: ['Pick one thing for today', 'Phone in another room', 'Work in short sprints', 'Take real breaks', 'Write tomorrow’s list tonight'], cta: 'Share with a friend', icon: 'lu-lightbulb' },
      { name: 'Plant care', kicker: 'Plant parent 101', title: 'Keep Your Plants Happy', items: ['Water when the soil is dry', 'Bright, indirect light', 'Turn the pot each week', 'Feed in spring and summer'], cta: 'Which one is yours?', icon: 'leaf', numbered: false },
      { name: 'Money tips', kicker: 'Money basics', title: 'Save More Without Trying', items: ['Pay yourself first', 'Automate your savings', 'Wait 48 hours before buying', 'Review subscriptions monthly'], cta: 'Follow for more', icon: 'lu-piggy-bank' },
    ],
  },
  {
    name: 'Testimonials', formats: ['post', 'portrait', 'story'], layouts: ['quote', 'card', 'minimal'],
    palettes: ['sky', 'sage', 'paper', 'lavender', 'navy'], pairs: ['Editorial', 'Classic', 'Modern', 'Clean'],
    tags: 'testimonial review customer feedback rating',
    items: [
      { name: 'Customer review', kicker: '★★★★★', title: '“The best service I have had in years. Friendly, fast and fair.”', sub: '— Hannah, happy customer', icon: 'star' },
      { name: 'Client love', kicker: 'Client love', title: '“They took our messy idea and turned it into a brand we’re proud of.”', sub: '— Marco, Little Fig Studio', icon: 'heart' },
      { name: 'Student story', kicker: 'Student stories', title: '“Six months ago I couldn’t code. Today I shipped my first app.”', sub: '— Aisha, class of spring', icon: 'thumbs-up' },
    ],
  },
  {
    name: 'Thank you', formats: ['post', 'card', 'story'], layouts: ['center', 'frame', 'card'],
    palettes: ['blush', 'sage', 'paper', 'lemon', 'navy'], pairs: ['Script', 'Calligraphy', 'Handmade', 'Elegant'],
    tags: 'thank you thanks gratitude appreciation card',
    items: [
      { name: 'Thank you', kicker: 'From all of us', title: 'Thank You', sub: 'for supporting our small business', info: 'Little Fig Studio', icon: 'heart', deco: 'heart', script: 'Pacifico' },
      { name: '10k followers', kicker: 'We did it', title: '10,000 Thank Yous', sub: 'To every one of you who follows, shares and cheers', info: 'Here’s to the next chapter', icon: 'lu-party-popper', deco: 'confetti-burst' },
      { name: 'Teacher thanks', kicker: 'For a wonderful year', title: 'Thank You, Teacher', sub: 'You made learning fun', info: 'With love, Room 12', icon: 'book', deco: 'daisy', script: 'Dancing Script' },
    ],
  },
  {
    name: 'Holidays', formats: ['post', 'story', 'invite'], layouts: ['center', 'frame', 'card'],
    palettes: ['navy', 'forest', 'burgundy', 'midnight', 'sunset'], pairs: ['Luxury', 'Wedding', 'Elegant', 'Magazine'],
    tags: 'holiday christmas new year diwali eid festive season greetings',
    items: [
      { name: 'Happy new year', kicker: 'Cheers to', title: 'Happy New Year', sub: 'Wishing you twelve months of good things', info: 'See you in the new year', icon: 'sparkle', deco: 'sparkle-trio', script: 'Great Vibes' },
      { name: 'Season’s greetings', kicker: 'Warm wishes', title: 'Season’s Greetings', sub: 'Peace, rest and good food with the people you love', info: 'From our family to yours', icon: 'lu-snowflake', deco: 'leaves' },
      { name: 'Festival of lights', kicker: 'Wishing you a bright', title: 'Festival of Lights', sub: 'May your home be full of light, sweets and laughter', info: 'Happy Diwali', icon: 'flame', deco: 'rosette' },
    ],
  },
  {
    name: 'Fundraising', formats: ['portrait', 'post', 'story'], layouts: ['split', 'stats', 'center'],
    palettes: ['mint', 'ocean', 'coral', 'sage', 'sky'], pairs: ['Friendly', 'Modern', 'Startup'],
    tags: 'charity fundraiser donate nonprofit cause volunteer',
    items: [
      { name: 'Donation drive', kicker: 'Help us reach', title: '$20,000 for the Food Bank', sub: 'Every $10 puts dinner on a family’s table', stats: [['$14,200', 'raised so far'], ['612', 'people have given']], cta: 'Donate today', info: 'cityfoodbank.example', icon: 'lu-hand-heart' },
      { name: 'Volunteers wanted', kicker: 'Lend a hand', title: 'Volunteers Wanted', sub: 'Two hours a week can change a neighborhood', stats: [['48', 'gardens planted'], ['300', 'volunteer hours']], cta: 'Sign up', info: 'Green Streets Project', icon: 'users' },
      { name: 'Charity run', kicker: 'Run for a reason', title: 'Charity Fun Run', sub: '5 km around the lake for the children’s hospital', stats: [['5 km', 'for all ages'], ['$30', 'entry, all donated']], cta: 'Register now', info: 'Sunday, Oct 12 · 9 am', icon: 'heart' },
    ],
  },
  {
    name: 'Community', formats: ['post', 'flyer', 'portrait'], layouts: ['corner', 'list', 'center'],
    palettes: ['sage', 'terracotta', 'lemon', 'ocean', 'mint'], pairs: ['Friendly', 'Handmade', 'Retro'],
    tags: 'community meetup neighborhood club group local',
    items: [
      { name: 'Book club', kicker: 'New members welcome', title: 'Neighborhood Book Club', sub: 'This month: a story about lighthouses', items: ['First Thursday of the month', 'Tea and biscuits', 'No pressure to finish'], info: 'Willow Café · 7 pm', icon: 'book' },
      { name: 'Clean-up day', kicker: 'Saturday morning', title: 'Park Clean-Up Day', sub: 'Gloves and bags provided, coffee too', items: ['Meet at the gate', 'All ages', 'Two hours, big difference'], info: 'Saturday · 9 am', icon: 'leaf' },
      { name: 'Meetup', kicker: 'Monthly meetup', title: 'Makers & Coffee', sub: 'Show what you’re building, meet your neighbors', items: ['Lightning talks', 'Free coffee', 'Bring a project'], info: 'Last Wednesday · 6 pm', icon: 'lu-coffee' },
    ],
  },
  {
    name: 'Sports', formats: ['portrait', 'post', 'story'], layouts: ['poster', 'marker', 'stats'],
    palettes: ['electric', 'coral', 'navy', 'sky', 'teal'], pairs: ['Impact', 'Bold poster', 'Headline'],
    tags: 'sports game match team league tournament football basketball',
    items: [
      { name: 'Game day', kicker: 'Home game', title: 'Game Day', sub: 'Tigers vs Hawks', stats: [['7 PM', 'kick-off'], ['$5', 'tickets at the gate']], cta: 'Wear orange', info: 'Riverside Stadium', icon: 'trophy' },
      { name: 'Tryouts', kicker: 'Join the team', title: 'Season Tryouts', sub: 'Under-12s and under-16s', stats: [['Aug 2', 'tryout day'], ['2', 'age groups']], cta: 'Bring water and boots', info: 'North Field · 10 am', icon: 'users' },
      { name: 'Final score', kicker: 'Full time', title: 'We Won!', sub: 'What a match. Thank you for the noise.', stats: [['3 – 1', 'final score'], ['12', 'wins in a row']], cta: 'Next game Saturday', info: '#GoTigers', icon: 'trophy' },
    ],
  },
  {
    name: 'Music', formats: ['post', 'portrait', 'story'], layouts: ['poster', 'minimal', 'center'],
    palettes: ['midnight', 'electric', 'sunset', 'burgundy', 'mono'], pairs: ['Retro', 'Magazine', 'Bold poster', 'Arcade'],
    tags: 'music album single release concert band dj',
    items: [
      { name: 'New single', kicker: 'Out Friday', title: 'Golden Hour', sub: 'The new single from Lumen', cta: 'Pre-save now', info: 'On all streaming services', icon: 'music' },
      { name: 'Live show', kicker: 'One night only', title: 'Lumen Live', sub: 'With special guests The Quiet Hours', cta: 'Tickets from $18', info: 'The Electric Room · Nov 8', icon: 'mic' },
      { name: 'Open mic', kicker: 'Every Thursday', title: 'Open Mic Night', sub: 'Songs, poems, comedy — all welcome', cta: 'Sign up at the bar', info: 'The Lantern · 8 pm', icon: 'lu-guitar' },
    ],
  },
  {
    name: 'Giveaways', formats: ['post', 'story', 'portrait'], layouts: ['badge', 'marker', 'card'],
    palettes: ['lemon', 'coral', 'lavender', 'electric', 'blush'], pairs: ['Playful', 'Impact', 'Friendly'],
    tags: 'giveaway contest win prize competition',
    items: [
      { name: 'Giveaway', kicker: 'Win it', title: 'Giveaway Time!', offer: 'WIN', sub: 'A year of free coffee for you and a friend', cta: 'Like, follow, tag a friend', info: 'Winner picked Friday', icon: 'gift' },
      { name: 'Contest', kicker: 'Photo contest', title: 'Show Us Your Pet', offer: '$100', sub: 'Best photo wins a gift card', cta: 'Post with #PetOfTheMonth', info: 'Entries close May 31', icon: 'paw' },
      { name: 'Birthday giveaway', kicker: 'We’re turning 5', title: 'Birthday Giveaway', offer: '5 PRIZES', sub: 'Five bundles for five years', cta: 'Enter on our page', info: 'Ends Sunday', icon: 'lu-party-popper' },
    ],
  },
  {
    name: 'Coming soon', formats: ['post', 'story', 'portrait'], layouts: ['minimal', 'center', 'poster'],
    palettes: ['mono', 'midnight', 'electric', 'navy', 'lavender'], pairs: ['Tech', 'Magazine', 'Clean', 'Luxury'],
    tags: 'coming soon launch teaser countdown',
    items: [
      { name: 'Coming soon', kicker: 'Something new', title: 'Coming Soon', sub: 'We can’t say much yet. Stay tuned.', cta: 'Turn on notifications', info: '01 · 06 · 27', icon: 'clock' },
      { name: 'Countdown', kicker: 'Launching in', title: '3 Days', sub: 'Mark your calendar', cta: 'Join the waitlist', info: 'Big things are coming', icon: 'calendar' },
      { name: 'Teaser', kicker: 'Sneak peek', title: 'Can You Guess What It Is?', sub: 'Drop your guesses below', cta: 'Reveal on Friday', info: 'Follow along', icon: 'eye' },
    ],
  },
  {
    name: 'Business cards', formats: ['card'], layouts: ['bizcard', 'bizcardCenter', 'bizcardBold'],
    palettes: ['mono', 'navy', 'sage', 'terracotta', 'midnight', 'sky'], pairs: ['Modern', 'Elegant', 'Clean', 'Startup'],
    tags: 'business card contact professional print',
    items: [
      { name: 'Designer card', title: 'Jordan Lee', kicker: 'Graphic designer', info: '555 0123\nhello@jordanlee.example\njordanlee.example', icon: 'pencil' },
      { name: 'Consultant card', title: 'Amara Okafor', kicker: 'Financial consultant', info: '555 0188\namara@okafor.example\nSuite 4, 10 King Street', icon: 'briefcase' },
      { name: 'Photographer card', title: 'Sam Rivera', kicker: 'Photographer', info: '555 0156\nsam@rivera.example\n@samshoots', icon: 'camera' },
    ],
  },
  {
    name: 'Logos', formats: ['logo'], layouts: ['logo', 'logoWord', 'logoBadge'],
    palettes: ['paper', 'midnight', 'sage', 'coral', 'navy', 'mint'], pairs: ['Modern', 'Elegant', 'Retro', 'Playful'],
    tags: 'logo brand identity mark emblem',
    items: [
      { name: 'Coffee logo', title: 'Bean & Leaf', kicker: 'Coffee roasters', icon: 'coffee' },
      { name: 'Studio logo', title: 'North Studio', kicker: 'Design & build', icon: 'lu-compass' },
      { name: 'Bakery logo', title: 'Little Crumb', kicker: 'Bakery · Est. 2024', icon: 'lu-wheat' },
    ],
  },
  {
    name: 'Certificates', formats: ['landscape'], layouts: ['frame', 'card', 'minimal'],
    palettes: ['navy', 'paper', 'burgundy', 'sage', 'mono'], pairs: ['Luxury', 'Classic', 'Elegant', 'Bookish'],
    tags: 'certificate award achievement diploma recognition',
    items: [
      { name: 'Certificate of achievement', kicker: 'Certificate of achievement', title: 'Alex Morgan', sub: 'for completing the Introduction to Design course with distinction', info: 'June 2027 · Signed, the Course Team', icon: 'lu-award', script: 'Great Vibes' },
      { name: 'Employee of the month', kicker: 'Employee of the month', title: 'Priya Shah', sub: 'for going above and beyond for our customers', info: 'Presented March 2027', icon: 'trophy', script: 'Dancing Script' },
      { name: 'Volunteer award', kicker: 'With gratitude', title: 'Volunteer of the Year', sub: 'presented to Tom Becker for 300 hours of service', info: 'Green Streets Project · 2027', icon: 'heart' },
    ],
  },
  {
    name: 'Resumes', formats: ['a4'], layouts: ['resume', 'resume', 'resume'],
    palettes: ['mono', 'sky', 'sage', 'terracotta', 'navy', 'lavender', 'paper', 'mint', 'burgundy'], pairs: ['Modern', 'Clean', 'Classic', 'Startup', 'Elegant'],
    tags: 'resume cv job application career',
    items: [
      { name: 'Designer resume', title: 'Jordan Lee', kicker: 'Product designer', sub: 'I design calm, useful software and the systems behind it. Eight years across startups and agencies.', info: '555 0123\nhello@jordanlee.example\nPortland, OR', items: ['Interaction design', 'Prototyping', 'Design systems', 'User research', 'Figma & code'], sections: [['Experience', 'Lead designer, Field Notes — 2023 to now\nRedesigned the core app and grew weekly use by 40%.\n\nProduct designer, Brightside — 2019 to 2023\nShipped onboarding, billing and a component library.'], ['Education', 'BA Graphic Design, State University — 2018'], ['Awards', 'Best mobile app, Design Week 2024']] },
      { name: 'Teacher resume', title: 'Maria Gomez', kicker: 'Primary school teacher', sub: 'Warm, organized teacher who loves helping children find their confidence.', info: '555 0145\nmaria.gomez@example.com\nAustin, TX', items: ['Lesson planning', 'Classroom management', 'Bilingual: English, Spanish', 'Parent communication'], sections: [['Experience', 'Year 3 teacher, Oak Hill Elementary — 2020 to now\nRaised reading scores by two levels in one year.\n\nTeaching assistant, Cedar School — 2017 to 2020'], ['Education', 'BEd Primary Education — 2017'], ['Certificates', 'First aid · Child safety · ESL teaching']] },
      { name: 'Developer resume', title: 'Kenji Watanabe', kicker: 'Software engineer', sub: 'Backend engineer who likes fast, boring, reliable systems.', info: '555 0172\nkenji@example.dev\ngithub.com/kenji-example', items: ['Go, TypeScript, SQL', 'Distributed systems', 'Postgres', 'Testing and CI', 'Mentoring'], sections: [['Experience', 'Senior engineer, Parcelly — 2022 to now\nCut checkout latency by 60% and led the move to event queues.\n\nEngineer, Datalite — 2018 to 2022'], ['Education', 'BSc Computer Science — 2018'], ['Open source', 'Maintainer of a small, popular CLI tool']] },
    ],
  },
  {
    name: 'Infographics', formats: ['portrait', 'story', 'pin'], layouts: ['stats', 'list', 'split'],
    palettes: ['sky', 'mint', 'paper', 'midnight', 'ocean'], pairs: ['Startup', 'Clean', 'Modern', 'Tech'],
    tags: 'infographic statistics data facts numbers report',
    items: [
      { name: 'Year in numbers', kicker: 'Our year', title: '2026 in Numbers', stats: [['12,400', 'orders shipped'], ['98%', 'happy customers'], ['31', 'new products']], info: 'Thank you for a great year', items: ['12,400 orders shipped', '98% happy customers', '31 new products'], icon: 'lu-chart-column' },
      { name: 'Water facts', kicker: 'Did you know?', title: 'Why Water Matters', stats: [['60%', 'of your body is water'], ['8', 'glasses a day is a good goal'], ['2 days', 'is how long you can feel thirsty first']], items: ['60% of your body is water', 'Aim for about 8 glasses a day', 'Thirst can show up late'], info: 'Drink up', icon: 'lu-droplet' },
      { name: 'Survey results', kicker: 'Survey results', title: 'How Our Team Works', stats: [['74%', 'work from home some days'], ['3', 'meetings a day on average'], ['9 am', 'most popular start time']], items: ['74% work from home some days', 'Three meetings a day on average', '9 am is the favorite start'], info: '212 people answered', icon: 'users' },
    ],
  },
  {
    name: 'Flyers', formats: ['flyer', 'a4', 'portrait'], layouts: ['list', 'split', 'poster'],
    palettes: ['coral', 'sky', 'lemon', 'sage', 'navy'], pairs: ['Friendly', 'Bold poster', 'Modern', 'Retro'],
    tags: 'flyer leaflet print class workshop service poster',
    items: [
      { name: 'Pottery class', kicker: 'Beginners welcome', title: 'Pottery for Beginners', sub: 'Six Tuesday evenings at the studio', items: ['All clay and firing included', 'Small groups of eight', 'Take home your pieces'], cta: '$180 for six weeks', info: 'Mud Room Studio · book online', icon: 'lu-palette' },
      { name: 'Lost cat', kicker: 'Please help', title: 'Lost Cat: Biscuit', sub: 'Orange tabby, white paws, very friendly', items: ['Last seen on Elm Street', 'Wearing a blue collar', 'Reward offered'], cta: 'Call 555 0110', info: 'Please check your sheds', icon: 'paw' },
      { name: 'Garden service', kicker: 'Local & reliable', title: 'Garden Help When You Need It', sub: 'Mowing, hedges, planting and tidy-ups', items: ['Free quotes', 'Insured', 'Weekly or one-off'], cta: 'Call 555 0133', info: 'Green Thumb Gardening', icon: 'leaf' },
    ],
  },
  {
    name: 'Banners', formats: ['banner'], layouts: ['banner', 'banner', 'banner'],
    palettes: ['sky', 'midnight', 'coral', 'sage', 'electric'], pairs: ['Startup', 'Modern', 'Bold poster'],
    tags: 'banner header website email newsletter twitter linkedin cover',
    items: [
      { name: 'Newsletter header', kicker: 'The weekly letter', title: 'Notes From the Studio', sub: 'Ideas, links and work in progress', icon: 'mail' },
      { name: 'Profile cover', kicker: 'Hello, I’m Jordan', title: 'I design friendly software', sub: 'Product designer · writer · tea drinker', icon: 'pencil' },
      { name: 'Shop banner', kicker: 'Free shipping over $50', title: 'Handmade Ceramics', sub: 'Small batches, made with care', cta: 'Shop now', icon: 'bag' },
    ],
  },
  {
    name: 'Pinterest', formats: ['pin'], layouts: ['list', 'card', 'marker'],
    palettes: ['terracotta', 'blush', 'sage', 'paper', 'lemon'], pairs: ['Editorial', 'Handmade', 'Magazine', 'Notebook'],
    tags: 'pinterest pin recipe diy blog ideas',
    items: [
      { name: 'Recipe pin', kicker: 'Ready in 20 minutes', title: 'One-Pan Lemon Pasta', items: ['Pasta, lemon, garlic', 'Parmesan and pepper', 'A handful of spinach'], cta: 'Get the recipe', icon: 'lu-chef-hat' },
      { name: 'DIY pin', kicker: 'Weekend project', title: 'Make Your Own Candles', items: ['Soy wax and wicks', 'A few drops of oil', 'Old jars, washed'], cta: 'Step-by-step guide', icon: 'flame' },
      { name: 'Ideas pin', kicker: 'Small space ideas', title: 'Ten Ways to Brighten a Small Room', items: ['Mirrors opposite windows', 'Light, warm paint', 'Plants on shelves'], cta: 'See all ten', icon: 'home' },
    ],
  },
  {
    name: 'Calendars', formats: ['portrait', 'a4'], layouts: ['calendar', 'calendar', 'calendar'],
    palettes: ['paper', 'sage', 'ocean', 'blush', 'lemon', 'lavender', 'mint', 'terracotta', 'sky'], pairs: ['Clean', 'Modern', 'Elegant', 'Friendly', 'Handmade'],
    tags: 'calendar month planner schedule date',
    items: [
      { name: 'January calendar', title: 'January', sub: 'New year, fresh pages', month: [2027, 0], deco: 'sun' },
      { name: 'April calendar', title: 'April', sub: 'Spring is here', month: [2027, 3], deco: 'flower' },
      { name: 'October calendar', title: 'October', sub: 'Cozy days ahead', month: [2027, 9], deco: 'leaves' },
    ],
  },
];

/**
 * Multi-page sets: decks, a full-year calendar and more. Each page is
 * [layout, content]; all pages share the set's palette and fonts.
 */
export const SETS = [
  {
    id: 'deck-pitch', name: 'Startup pitch deck', category: 'Presentations', format: 'slides', palette: 'midnight', pair: 'Startup', tags: 'pitch deck startup investor presentation slides',
    pages: [
      ['split', { kicker: 'Seed round · 2027', title: 'Notely: notes that think with you', sub: 'Pitch deck', icon: 'rocket' }],
      ['list', { kicker: 'The problem', title: 'Notes get lost', items: ['The average person uses four note apps', 'Most notes are never read again', 'Search finds words, not ideas'] }],
      ['split', { kicker: 'The solution', title: 'One place that links everything', sub: 'Notely connects related notes automatically, offline and private.', icon: 'lu-lightbulb' }],
      ['stats', { kicker: 'Traction', title: 'Growing every week', stats: [['48,000', 'weekly users'], ['22%', 'month-over-month growth'], ['4.8 ★', 'app store rating']] }],
      ['quote', { title: 'Notely is the first app that made my notes useful again.', kicker: 'Early user, design lead', dark: true }],
      ['center', { kicker: 'Thank you', title: 'Let’s build it together', sub: 'founders@notely.example', icon: 'mail' }],
    ],
  },
  {
    id: 'deck-lesson', name: 'Classroom lesson', category: 'Presentations', format: 'slides', palette: 'lemon', pair: 'Playful', tags: 'lesson class teacher school education presentation slides',
    pages: [
      ['center', { kicker: 'Science · Lesson 4', title: 'The Water Cycle', sub: 'Where does the rain come from?', icon: 'cloud' }],
      ['list', { kicker: 'Today we will', title: 'Learning goals', items: ['Name the four stages', 'Explain evaporation', 'Draw the cycle from memory'] }],
      ['split', { kicker: 'Step 1', title: 'Evaporation', sub: 'The sun warms water and turns it into vapor that rises into the air.', icon: 'sun' }],
      ['split', { kicker: 'Step 2', title: 'Condensation', sub: 'High up it cools and forms tiny droplets — clouds!', icon: 'cloud' }],
      ['marker', { kicker: 'Quick quiz', title: 'What makes the vapor rise?', sub: 'Talk with a partner for one minute.' }],
      ['center', { kicker: 'Homework', title: 'Draw the cycle at home', sub: 'Label every stage and bring it on Friday', icon: 'pencil' }],
    ],
  },
  {
    id: 'deck-report', name: 'Quarterly report', category: 'Presentations', format: 'slides', palette: 'sky', pair: 'Clean', tags: 'report quarterly business review results presentation slides',
    pages: [
      ['minimal', { kicker: 'Q3 business review', title: 'Quarterly Report', sub: 'Results, lessons and plans', info: 'Prepared by the operations team' }],
      ['stats', { kicker: 'Highlights', title: 'A record quarter', stats: [['$1.2M', 'revenue, up 18%'], ['340', 'new customers'], ['96%', 'kept their plan']] }],
      ['list', { kicker: 'What went well', title: 'Wins', items: ['Launched in two new cities', 'Support replies under one hour', 'Shipped the mobile app'], numbered: false }],
      ['list', { kicker: 'What we learned', title: 'Lessons', items: ['Onboarding needs a human touch', 'Annual plans sell better in spring', 'Fewer, bigger launches'], numbered: false }],
      ['split', { kicker: 'Next quarter', title: 'Focus on retention', sub: 'Three projects to help customers succeed in their first month.', icon: 'trophy' }],
      ['center', { kicker: 'Questions?', title: 'Thank you', sub: 'ops@company.example', icon: 'chat' }],
    ],
  },
  {
    id: 'deck-portfolio', name: 'Creative portfolio', category: 'Presentations', format: 'slides', palette: 'paper', pair: 'Editorial', tags: 'portfolio creative work case study presentation slides',
    pages: [
      ['minimal', { kicker: 'Portfolio 2027', title: 'Jordan Lee', sub: 'Selected work in brand and product design', info: 'jordanlee.example' }],
      ['split', { kicker: 'About me', title: 'Designer, maker, explainer', sub: 'I help small teams look as good as their ideas.', icon: 'user' }],
      ['corner', { kicker: 'Case study 01', title: 'Bean & Leaf rebrand', sub: 'A warmer identity that doubled café visits from social', icon: 'coffee' }],
      ['corner', { kicker: 'Case study 02', title: 'Notely mobile app', sub: 'From idea to app store in twelve weeks', icon: 'rocket' }],
      ['quote', { title: 'Jordan understood what we meant before we did.', kicker: 'Founder, Bean & Leaf' }],
      ['center', { kicker: 'Let’s talk', title: 'Available from May', sub: 'hello@jordanlee.example', icon: 'mail' }],
    ],
  },
  {
    id: 'deck-workshop', name: 'Workshop slides', category: 'Presentations', format: 'slides', palette: 'teal', pair: 'Tech', tags: 'workshop training talk agenda presentation slides',
    pages: [
      ['poster', { kicker: 'Hands-on workshop', title: 'Shipping Your First Website', sub: 'Two hours, zero to online', info: 'Bring a laptop', cta: 'Room 2B', icon: 'globe' }],
      ['list', { kicker: 'Agenda', title: 'What we’ll cover', items: ['How the web works', 'Your first page', 'Making it look good', 'Putting it online'] }],
      ['split', { kicker: 'Part 1', title: 'How the web works', sub: 'Browsers ask, servers answer. That’s most of it.', icon: 'globe' }],
      ['marker', { kicker: 'Try it', title: 'Make a page that says hello', sub: 'Ten minutes · pair up if you like' }],
      ['stats', { kicker: 'You did it', title: 'By the end of today', stats: [['1', 'website online'], ['0', 'dollars spent']] }],
      ['center', { kicker: 'Thanks for coming', title: 'Keep building', sub: 'Slides and links in the group chat', icon: 'heart' }],
    ],
  },
  {
    id: 'deck-wedding', name: 'Wedding slideshow', category: 'Presentations', format: 'slides', palette: 'burgundy', pair: 'Wedding', tags: 'wedding slideshow reception story love presentation slides',
    pages: [
      ['frame', { kicker: 'Welcome to the wedding of', title: 'Ava & Noah', sub: 'September 12, 2027', script: 'Great Vibes' }],
      ['center', { kicker: 'How it started', title: 'A rainy bus stop, 2019', sub: 'One umbrella, two strangers', icon: 'cloud', deco: 'heart' }],
      ['center', { kicker: 'The proposal', title: 'On top of Pine Ridge', sub: 'She said yes before he finished', icon: 'lu-gem', deco: 'sparkle-trio' }],
      ['list', { kicker: 'Tonight', title: 'Order of the evening', items: ['Dinner at 6', 'Speeches at 7:30', 'First dance at 8', 'Dancing until late'] }],
      ['frame', { kicker: 'Thank you for', title: 'Celebrating With Us', sub: 'Share your photos with #AvaAndNoah', script: 'Dancing Script' }],
    ],
  },
  {
    id: 'calendar-2027', name: '2027 wall calendar', category: 'Calendars', format: 'portrait', palette: 'sage', pair: 'Clean', tags: 'calendar 2027 year wall planner monthly',
    pages: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      .map((m, i) => ['calendar', { title: m, month: [2027, i], deco: ['sun', 'cloud', 'flower', 'daisy', 'flower', 'sun', 'waves', 'sun', 'leaves', 'leaves', 'leaves', 'sparkle-trio'][i] }]),
  },
  {
    id: 'menu-bistro', name: 'Bistro menu', category: 'Menus', format: 'a4', palette: 'forest', pair: 'Classic', tags: 'menu restaurant bistro food drinks two pages',
    pages: [
      ['menu', { kicker: 'Bistro Verde', title: 'Food', items: ['Soup of the day | 7', 'Burrata, peach, basil | 12', 'Steak frites | 24', 'Mushroom risotto | 19', 'Grilled sea bass | 26', 'Green salad | 6', 'Chocolate tart | 8'], info: 'Ask us about allergies' }],
      ['menu', { kicker: 'Bistro Verde', title: 'Drinks', items: ['House red or white | 8', 'Sparkling | 10', 'Craft lager | 6', 'Garden spritz | 11', 'Elderflower soda | 4', 'Espresso | 3'], info: 'Happy hour 5–7 pm' }],
    ],
  },
  {
    id: 'planner-week', name: 'Weekly planner', category: 'Planners', format: 'a4', palette: 'lavender', pair: 'Notebook', tags: 'planner weekly schedule to do habits organizer',
    pages: [
      ['list', { kicker: 'This week', title: 'Weekly Planner', items: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Weekend'], numbered: false, boxed: true }],
      ['list', { kicker: 'Focus', title: 'Top Priorities', items: ['', '', '', '', ''], boxed: true }],
      ['list', { kicker: 'Habits', title: 'Habit Tracker', items: ['Water ○ ○ ○ ○ ○ ○ ○', 'Move ○ ○ ○ ○ ○ ○ ○', 'Read ○ ○ ○ ○ ○ ○ ○', 'Sleep by 11 ○ ○ ○ ○ ○ ○ ○'], numbered: false, boxed: true }],
    ],
  },
  {
    id: 'planner-day', name: 'Daily planner', category: 'Planners', format: 'a4', palette: 'mint', pair: 'Clean', tags: 'planner daily schedule to do organizer',
    pages: [
      ['list', { kicker: 'Today', title: 'Daily Plan', items: ['8 am', '10 am', '12 pm', '2 pm', '4 pm', '6 pm'], numbered: false }],
      ['list', { kicker: 'Notes', title: 'To Do', items: ['○', '○', '○', '○', '○', '○'], numbered: false }],
    ],
  },
  {
    id: 'planner-meal', name: 'Meal planner', category: 'Planners', format: 'portrait', palette: 'terracotta', pair: 'Handmade', tags: 'meal planner food week grocery list',
    pages: [
      ['list', { kicker: 'Eat well', title: 'Meal Plan', items: ['Mon ·', 'Tue ·', 'Wed ·', 'Thu ·', 'Fri ·', 'Sat ·', 'Sun ·'], numbered: false }],
      ['list', { kicker: 'Shopping', title: 'Grocery List', items: ['Fruit & veg', 'Dairy', 'Bakery', 'Pantry', 'Other'], numbered: false }],
    ],
  },
  {
    id: 'kit-social', name: 'Brand launch carousel', category: 'Social media sets', format: 'portrait', palette: 'coral', pair: 'Friendly', tags: 'carousel instagram slides brand launch multi page social',
    pages: [
      ['marker', { kicker: 'Swipe →', title: 'Meet our new look', sub: 'Same us. Fresh coat of paint.' }],
      ['list', { kicker: 'What changed', title: 'Three things', items: ['A friendlier logo', 'Brighter colors', 'Easier packaging'] }],
      ['quote', { title: 'We wanted it to feel like a smile at the counter.', kicker: 'Our founder' }],
      ['center', { kicker: 'Come see', title: 'In stores Friday', sub: 'Tag us in your first photo', icon: 'lu-store' }],
    ],
  },
];
