// Words people search templates by, in their language, and the English
// words templates are tagged with: the kinds the "no match" hint suggests,
// and the common ones besides. (Category names are matched as translated
// too: see searchTemplates.)

const WORDS = {
  es: {
    rebajas: 'sale', oferta: 'sale', invitación: 'invitation', invitar: 'invite', currículum: 'resume', cv: 'resume', menú: 'menu', carta: 'menu',
    póster: 'poster', cartel: 'poster', folleto: 'flyer', volante: 'flyer', cumpleaños: 'birthday', boda: 'wedding',
    'tarjeta de visita': 'business card', logotipo: 'logo', logo: 'logo', presentación: 'presentation',
  },
  fr: {
    soldes: 'sale', promo: 'sale', invitation: 'invitation', inviter: 'invite', cv: 'resume', 'curriculum vitae': 'resume', menu: 'menu', carte: 'menu',
    affiche: 'poster', poster: 'poster', flyer: 'flyer', prospectus: 'flyer', anniversaire: 'birthday', mariage: 'wedding',
    'carte de visite': 'business card', logo: 'logo', présentation: 'presentation',
  },
  de: {
    sale: 'sale', angebot: 'sale', einladung: 'invitation', einladen: 'invite', lebenslauf: 'resume', speisekarte: 'menu', menü: 'menu',
    plakat: 'poster', poster: 'poster', flyer: 'flyer', handzettel: 'flyer', geburtstag: 'birthday', hochzeit: 'wedding',
    visitenkarte: 'business card', logo: 'logo', präsentation: 'presentation',
  },
  'pt-BR': {
    promoção: 'sale', liquidação: 'sale', convite: 'invitation', convidar: 'invite', currículo: 'resume', cardápio: 'menu', menu: 'menu',
    pôster: 'poster', cartaz: 'poster', panfleto: 'flyer', folheto: 'flyer', aniversário: 'birthday', casamento: 'wedding',
    'cartão de visita': 'business card', logotipo: 'logo', logo: 'logo', apresentação: 'presentation',
  },
  hi: {
    सेल: 'sale', निमंत्रण: 'invitation', न्योता: 'invite', बायोडाटा: 'resume', रिज्यूमे: 'resume', मेन्यू: 'menu', मेनू: 'menu',
    पोस्टर: 'poster', फ़्लायर: 'flyer', पर्चा: 'flyer', जन्मदिन: 'birthday', शादी: 'wedding', विवाह: 'wedding',
    'बिज़नेस कार्ड': 'business card', 'विज़िटिंग कार्ड': 'business card', लोगो: 'logo', प्रेज़ेंटेशन: 'presentation', प्रस्तुति: 'presentation',
  },
  ar: {
    تخفيضات: 'sale', عرض: 'sale', دعوة: 'invitation', 'سيرة ذاتية': 'resume', 'قائمة طعام': 'menu', منيو: 'menu',
    ملصق: 'poster', بوستر: 'poster', نشرة: 'flyer', منشور: 'flyer', 'عيد ميلاد': 'birthday', زفاف: 'wedding',
    'بطاقة عمل': 'business card', شعار: 'logo', لوجو: 'logo', 'عرض تقديمي': 'presentation',
  },
  ja: {
    セール: 'sale', 招待状: 'invitation', 招待: 'invite', 履歴書: 'resume', メニュー: 'menu',
    ポスター: 'poster', チラシ: 'flyer', フライヤー: 'flyer', 誕生日: 'birthday', 結婚式: 'wedding', ウェディング: 'wedding',
    名刺: 'business card', ロゴ: 'logo', プレゼンテーション: 'presentation', プレゼン: 'presentation',
  },
  kn: {
    ಮಾರಾಟ: 'sale', ಆಮಂತ್ರಣ: 'invitation', ಆಹ್ವಾನ: 'invite', ರೆಸ್ಯೂಮೆ: 'resume', ಸ್ವವಿವರ: 'resume', ಮೆನು: 'menu',
    ಪೋಸ್ಟರ್: 'poster', ಕರಪತ್ರ: 'flyer', ಫ್ಲೈಯರ್: 'flyer', ಹುಟ್ಟುಹಬ್ಬ: 'birthday', ಮದುವೆ: 'wedding', ವಿವಾಹ: 'wedding',
    'ವಿಸಿಟಿಂಗ್ ಕಾರ್ಡ್': 'business card', 'ಬಿಸಿನೆಸ್ ಕಾರ್ಡ್': 'business card', ಲೋಗೋ: 'logo', ಪ್ರಸ್ತುತಿ: 'presentation',
  },
};

/** A language's search words → the English words templates are tagged with ({} for English). */
export function templateWords(lang) {
  return WORDS[lang] || {};
}

/** Every language with search words of its own. */
export const TEMPLATE_WORD_LANGUAGES = Object.keys(WORDS);
