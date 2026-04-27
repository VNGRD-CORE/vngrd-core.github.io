/* ═══════════════════════════════════════════════════════════════════════
   MCR // SIGNAL_CENTRAL  —  Native Speech Engine  v6  (4-Slot Modular)
   -----------------------------------------------------------------------
   Signal chain:
     Browser SpeechRecognition (continuous + interimResults)
       → EN transcript (primary ear)
       → 4 configurable SLOTS: OFF / EN / NL / ES / FR / ZH / JA / AR / SCOUSE
       → Active slots rendered as stacked lines in #vanguard-subtitles
       → Final results synced to P2P peers via sendUISync

   SCOUSE uses a local dictionary (zero latency, no fetch).
   AR triggers direction:rtl on its subtitle line.
   No WebSocket, no Python backend, no localhost dependency.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var onAir          = false;
    var recognition    = null;
    var lastFinal      = '';
    var _langSwitching = false;   // prevents onend auto-restart during language swap

    /* ── Dialect translation engine — phrase-aware dictionary lookup ───── */
    // Tries 3-word, then 2-word, then 1-word matches so multi-word idioms
    // take precedence over individual word substitutions.
    function translateWithDict(text, dict) {
        if (!text) return '';
        var words = text.split(/\s+/);
        var result = [];
        var i = 0;
        while (i < words.length) {
            var matched = false;
            // Try 3-word phrase
            if (i + 2 < words.length) {
                var three = words[i] + ' ' + words[i+1] + ' ' + words[i+2];
                if (dict[three]) { result.push(dict[three]); i += 3; matched = true; }
            }
            if (!matched && i + 1 < words.length) {
                var two = words[i] + ' ' + words[i+1];
                if (dict[two]) { result.push(dict[two]); i += 2; matched = true; }
            }
            if (!matched) {
                result.push(dict[words[i]] || words[i]);
                i++;
            }
        }
        return result.join(' ');
    }

    /* ── Scouse dictionary ────────────────────────────────────────────── */
    var SCOUSE_DICT = {
        /* ── Multi-word phrases (matched first by translateWithDict) ── */
        'HOW ARE YOU':'ALRIGHT THERE LA','HOW ARE YA':'ALRIGHT THERE LA',
        'ARE YOU ALRIGHT':'YER SOUND MATE','YOU ALRIGHT':'YER SOUND MATE',
        'I AM':'A AM','I AM NOT':'A AM NOT','AM I':'AM A',
        'YOU ARE':'YER','YOU ARE NOT':'YER NOT','YOU HAVE':'YER HAVE',
        'ARE YOU':'IS YER','DO YOU':'D YER','HAVE YOU':'AVE YER',
        'I KNOW':'A KNOW LA','I THINK':'A RECKON','I WANT':'A WANT',
        'I NEED':'A NEED','I LIKE':'A LIKE','I LOVE':'A LOVE',
        'I HATE':'A CANT STAND','I SEE':'A SEE LA',
        'NO PROBLEM':'NO WORRIES LA','OF COURSE':'DEAD CERT',
        'COME ON':'COME ED','COME HERE':'GERROV ERE',
        'SHUT UP':'SHUT YER GOB','BE QUIET':'PACK IT IN',
        'GET OUT':'DO ONE','GET LOST':'DO ONE LA',
        'WELL DONE':'NICE ONE LA','GOOD JOB':'NICE ONE',
        'NO WAY':'AS IF LA','COME OFF IT':'YER AVIN A LAUGH',
        'ARE YOU JOKING':'YER AVIN A LAUGH LA',
        'ARE YOU SERIOUS':'YER NOT SERIOUS LA',
        'I CANNOT':'A CANT','I CAN NOT':'A CANT',
        'I DO NOT':'A DONT','I DON\'T':'A DONT',
        'DO NOT':'DONT YER','DON\'T':'DONT',
        'GOOD MORNING':'ALRIGHT LA HOW YER DOIN',
        'GOOD NIGHT':'TARRAH LA SLEEP WELL',
        'GOOD LUCK':'ALL THE BEST LA',
        'TAKE CARE':'LOOK AFTER YERSELF',
        'SEE YOU':'SEE YER LA','SEE YOU LATER':'SEE YER LATER LA',
        'WHAT IS':'WHARRIS','WHAT ARE':'WHARRER',
        'WHAT DO':'WHARRER YER','WHERE IS':'WHERRIZ',
        'GOING TO':'GONNA','WANT TO':'WANNA','HAVE TO':'AVTA',
        'NEED TO':'NEED TA','ABLE TO':'ABLE TA',
        'SORT IT OUT':'SORT IT LA','CALM DOWN':'CALM DOWN WILL YER',
        'LET ME':'LERRUS','LET US':'LERRUS',
        'LISTEN TO ME':'AV A LISTEN LA','LOOK AT ME':'LOOK AT US LA',
        'WHAT THE HELL':'WHARR THE ECK','WHAT THE HECK':'WHARR THE ECK',
        'OH MY GOD':'OH ME GOD','OH MY GOODNESS':'OH HECK LA',
        'I SWEAR':'A SWEAR DOWN','TO BE HONEST':'IF AM BEIN HONEST LA',
        'TO BE FAIR':'T BE FAIR LIKE',
        'AT THE END OF THE DAY':'AT THE END O THE DAY LIKE',
        'WHAT A SHAME':'AW WHARR A SHAME','WHAT A PITY':'AW SHAME LA',
        /* ── Greetings & responses ── */
        'HELLO':'ALRIGHT LA','HI':'ALRIGHT LA','HEY':'ALRIGHT LA',
        'GOODBYE':'TARRAH LA','BYE':'TARRAH','SEE YA':'TARRAH LA',
        'CHEERS':'TA LA','THANKS':'TA VERY MUCH','THANK':'TA',
        'PLEASE':'GO ON THEN','SORRY':'SORRY LA','APOLOGIES':'SORRY ABOUT THAT LA',
        'YES':'YEAH LAD','NO':'NAH LAD','SURE':'GO ED','DEFINITELY':'DEAD CERT',
        'OK':'BOSS LA','FINE':'SOUND','DEAL':'SORTED LA','DONE':'SORTED',
        'RIGHT':'SOUND','CORRECT':'DEAD RIGHT','EXACTLY':'DEAD RIGHT LA',
        'MAYBE':'MIGHT DO','PERHAPS':'MIGHT DO LA','POSSIBLY':'COULD DO',
        'WHATEVER':'WHATEVER LA','OBVIOUSLY':'OBVIOUSLY LIKE',
        'ANYWAY':'ANYWEH','ACTUALLY':'ACTUALLY LIKE',
        'BASICALLY':'BASICALLY LIKE','LITERALLY':'LITERALLY DEAD',
        /* ── People & relationships ── */
        'FRIEND':'LAD','FRIENDS':'LADS','MATE':'LAD','BUDDY':'LAD','PAL':'LAD',
        'LADS':'LADS','GUYS':'LADS','PEOPLE':'LADS','EVERYONE':'EVERYONE LA',
        'MAN':'FELLA','GUY':'FELLA','BLOKE':'FELLA','GENTLEMAN':'FELLA',
        'WOMAN':'BIRD','GIRL':'BIRD','LADY':'BIRD','LADIES':'BIRDS',
        'BOYFRIEND':'ME FELLA','GIRLFRIEND':'ME BIRD',
        'WIFE':'THE MISSUS','HUSBAND':'THE FELLA',
        'PARTNER':'OTHER ALF','LOVER':'BIRD',
        'MUM':'ME MAM','MOM':'ME MAM','MOTHER':'ME MAM','MAMA':'ME MAM',
        'DAD':'ME DAD','FATHER':'ME DAD','PAPA':'ME DAD',
        'BABY':'BABA','INFANT':'BABA','TODDLER':'BABA',
        'CHILD':'KIDDA','KID':'KIDDA','CHILDREN':'KIDDAS','KIDS':'KIDDAS',
        'BROTHER':'OUR KID','SISTER':'OUR KID','SIBLING':'OUR KID',
        'GRANDMOTHER':'NANA','GRANDMA':'NANA','GRANNY':'NANA',
        'GRANDFATHER':'GRANDAD','GRANDPA':'GRANDAD',
        'UNCLE':'UNCLE LA','AUNT':'AUNTIE',
        'COUSIN':'CUZZY','NEIGHBOUR':'NEXT DOOR',
        'BOSS':'GAFFER','MANAGER':'GAFFER','TEACHER':'SIR','PROFESSOR':'PROF',
        'POLICE':'BIZZIES','COP':'BIZZY','COPS':'BIZZIES','OFFICER':'BIZZY',
        'DOCTOR':'DOC','NURSE':'NURSEY','STRANGER':'SOME FELLA',
        'LIAR':'WOOL','COWARD':'WOOL','OUTSIDER':'WOOL',
        /* ── Body parts ── */
        'HEAD':'ED','FACE':'GRID','MOUTH':'GOB','NOSE':'CONK',
        'EYES':'MINCERS','EYE':'MINCER','EARS':'LUGOLES','EAR':'LUGOLE',
        'HANDS':'MITTS','HAND':'MITT','FEET':'PLATES','FOOT':'PLATE',
        'STOMACH':'BELLY','BOTTOM':'BACKSIDE','HAIR':'BARNET',
        'TEETH':'GNASHERS','TOOTH':'GNASHER',
        /* ── Emotions & states ── */
        'GOOD':'BOSS','GREAT':'BOSS','COOL':'SOUND','NICE':'SOUND',
        'PERFECT':'BOSS','EXCELLENT':'BELTER','AMAZING':'BELTER',
        'BRILLIANT':'BELTER','FANTASTIC':'CLASS','WONDERFUL':'CLASS',
        'OUTSTANDING':'PROPER CLASS','IMPRESSIVE':'DEAD IMPRESSIVE',
        'LOVELY':'GORGEOUS LA','GORGEOUS':'GORGEOUS LA',
        'BEAUTIFUL':'GORGEOUS LA','HANDSOME':'BOSS LOOKING',
        'ATTRACTIVE':'WELL FIT','FIT':'WELL FIT',
        'HAPPY':'MADE UP','EXCITED':'BUZZING','PLEASED':'MADE UP',
        'DELIGHTED':'MADE UP','THRILLED':'ABSOLUTELY BUZZING',
        'SURPRISED':'MADE UP','SHOCKED':'GOBSMACKED','STUNNED':'GOBSMACKED',
        'LUCKY':'JAMMY','FORTUNATE':'JAMMY',
        'ANGRY':'FUMING','MAD':'FUMING','ANNOYED':'FUMING',
        'FURIOUS':'PROPER FUMING','LIVID':'PURE FUMING',
        'UPSET':'IN BITS','SAD':'IN BITS','DEPRESSED':'IN BITS LA',
        'CRYING':'BLARTIN','CRY':'HAVE A BLART','WEEP':'HAVE A BLART',
        'NERVOUS':'BRICKIN IT','SCARED':'BRICKIN IT','WORRIED':'BRICKIN IT',
        'ANXIOUS':'BRICKIN IT','FRIGHTENED':'BRICKIN IT',
        'EMBARRASSED':'SHOWING MESELF UP','ASHAMED':'SHOWING MESELF UP',
        'TIRED':'KNACKERED','EXHAUSTED':'CREAM CRACKERED',
        'SLEEPY':'DEAD TIRED','BORED':'DEAD BORED',
        'DRUNK':'RATARSED','TIPSY':'HALF CUT','HUNGOVER':'HANGING',
        'VERY':'DEAD','REALLY':'DEAD','ABSOLUTELY':'DEAD',
        'EXTREMELY':'PROPER','INCREDIBLY':'DEAD','TOTALLY':'PROPER',
        'QUITE':'PROPER','RATHER':'DEAD','FAIRLY':'DECENTISH',
        'SICK':'MINGING','ILL':'PROPER ILL','POORLY':'PROPER ILL',
        'UNWELL':'UNDER THE WEATHER','DISGUSTING':'MINGIN',
        'BAD':'MINGING','AWFUL':'MINGING','TERRIBLE':'MINGING',
        'RUBBISH':'GRIM','AWFUL':'MINGING','PATHETIC':'GRIM',
        'UGLY':'MINGING','WRONG':'MINGING','HORRIBLE':'MINGING',
        'CRAZY':'BARMEY','WEIRD':'BARMEY','STRANGE':'BARMEY',
        'MENTAL':'BARMEY LA','INSANE':'PROPER BARMEY',
        'BORING':'DEAD BORIN','FUNNY':'DEAD FUNNY',
        'HILARIOUS':'DEAD FUNNY LA','INTERESTING':'QUALITY',
        'CLEVER':'CLEVER CLOGS','SMART':'CLEVER CLOGS',
        'STUPID':'DIVVY','IDIOT':'DIVVY','FOOL':'DIVVY',
        'MORON':'DIVVY LA','NUMPTY':'DIVVY','DAFT':'DIVVY',
        'HONEST':'STRAIGHT UP','GENUINE':'DEAD GENUINE',
        'FAST':'PROPER QUICK','QUICK':'SWIFTY','SLOW':'DEAD SLOW',
        'HOT':'BOILING LA','WARM':'ROASTIN','COLD':'FREEZING LA',
        'FREEZING':'BALTIC','CHILLY':'BITTER OUT',
        'BROKEN':'BRASSIC','POOR':'BRASSIC','SKINT':'SKINT AS',
        'RICH':'LOADSAMONEY','WEALTHY':'WELL MINTED','MINTED':'WELL MINTED',
        'LUCKY':'JAMMY','UNLUCKY':'PROPER UNLUCKY LA',
        /* ── Actions ── */
        'RUN':'LEG IT','RUNNING':'LEGGIN IT','SPRINT':'PROPER LEG IT',
        'WALK':'MOSEY','WALKING':'MOSEYIN','STROLL':'BIMBLE',
        'LEAVE':'DO ONE','ESCAPE':'DO ONE','FLEE':'LEG IT',
        'GO':'GET GONE','COME':'GERRIN','ARRIVE':'FETCH UP',
        'THROW':'LOB','TOSS':'LOB','HIT':'LAMP','PUNCH':'LAMP',
        'KICK':'BOOT','PUSH':'SHOVE','PULL':'YANK',
        'LAUGH':'AVE THE CRACK','SMILE':'GIVE US A GRIN',
        'FIGHT':'SCRAP','FIGHTING':'SCRAPPING','BATTLE':'PROPER SCRAP',
        'ARGUE':'AVE A BARNEY','ARGUING':'AVIN A BARNEY',
        'STEAL':'BLAG','STOLE':'BLAGGED','ROB':'BLAG',
        'TALK':'GOB OFF','TALKING':'GOBBIN OFF','SPEAK':'GOB OFF',
        'SHOUT':'KICK OFF','SHOUTING':'KICKIN OFF',
        'WHISPER':'GERRIN CLOSE LA','SING':'BELT IT OUT',
        'EAT':'AVE SCRAN','EATING':'AVIN SCRAN',
        'DRINK':'AVE A BEVVY','DRINKING':'AVIN A BEVVY',
        'SMOKE':'AVE A CIGGY','WAIT':'HANG ON LA',
        'HURRY':'GERRON','RUSH':'PROPER HURRY','STOP':'PACK IT IN',
        'START':'GERRON WITH IT','BEGIN':'CRACK ON',
        'LOOK':'AV A GANDER','LOOKING':'AVIN A GANDER','SEE':'CLOCK',
        'WATCH':'KEEP AN EYE ON','LISTEN':'AVE A LISTEN',
        'HEAR':'CLOCK THAT','FEEL':'GET A SENSE OF',
        'THINK':'RECKON','BELIEVE':'RECKON','KNOW':'KNOW LIKE',
        'UNDERSTAND':'GET ME','UNDERSTOOD':'GOT ME','LEARN':'GET THE HANG OF',
        'REMEMBER':'KEEP IN MIND','FORGET':'FORGET ABOUT IT',
        'WORK':'GRAFT','WORKING':'GRAFTIN','GRAFT':'GRAFT',
        'SLEEP':'AVE A KIP','SLEEPING':'AVIN A KIP',
        'WAKE':'WAKE YERSELF UP','PLAY':'AVE A GAME',
        'WIN':'SMASH IT','LOSE':'GET DONE','TRY':'AVE A GO',
        'HELP':'GIVE US A HAND','GIVE':'GERRIT','TAKE':'GRAB',
        'BUY':'GERRIN','SELL':'SHIFT','PAY':'SORT','SPEND':'LAY OUT',
        'CALL':'BELL','PHONE':'BLOWER','TEXT':'SEND A MESSAGE',
        'VISIT':'POP ROUND','STAY':'STOP ROUND','LIVE':'STOP',
        'MOVE':'DO ONE','CHANGE':'SWITCH UP','FIX':'SORT',
        'BREAK':'SMASH','CLEAN':'DO A CLEAN UP','COOK':'DO A COOK UP',
        'DRIVE':'BRUM','PARK':'STICK IT',
        /* ── Things & places ── */
        'FOOD':'SCRAN','MEAL':'SCRAN','DINNER':'TEA','LUNCH':'DINNER',
        'BREAKFAST':'BRECKY','SNACK':'LITTLE SCRAN',
        'COFFEE':'BREW','TEA':'BREW','CUP':'CUPPA','MUG':'MUGGA',
        'BEER':'BEVVY','WINE':'VINO','ALCOHOL':'BEVVY',
        'PUB':'BOOZER','BAR':'BOOZER','CLUB':'JOINT','PARTY':'DO',
        'SANDWICH':'BUTTY','ROLL':'BUTTY','BAGUETTE':'BUTTY',
        'CHIP':'CHIP','CHIPS':'CHIPS','CURRY':'CURRY LA',
        'CHOCOLATE':'CHOCCY','SWEET':'SWEETIE','CAKE':'CAKE LA',
        'MONEY':'DOSH','CASH':'DOSH','COINS':'COPPERS',
        'POUND':'QUID','POUNDS':'QUID','PENNY':'COP','PENCE':'COPPERS',
        'HOUSE':'GAFF','HOME':'GAFF','FLAT':'FLAT','APARTMENT':'FLAT',
        'ROOM':'ROOM LA','KITCHEN':'THE BACK','GARDEN':'THE BACK',
        'STREET':'THE STREET','ROAD':'JIGGER','ALLEY':'JIGGER',
        'TOILET':'LAVVY','BATHROOM':'LAVVY','SHOWER':'SHOWER LA',
        'TELEVISION':'TELLY','TV':'TELLY','RADIO':'WIRELESS',
        'PHONE':'BLOWER','MOBILE':'MOBIE','COMPUTER':'PUTER',
        'INTERNET':'THE WEB','MUSIC':'TUNES','SONG':'TUNE',
        'CAR':'JAM JAR','VAN':'VAN LA','BIKE':'BICY',
        'BUS':'BUSSY','TAXI':'HACKY','TRAIN':'RATTLER',
        'AIRPORT':'AIRPORT LA','STATION':'STATION LA',
        'SHOP':'THE SHOP','STORE':'THE SHOP',
        'SUPERMARKET':'THE MESSAGES','SHOPPING':'THE MESSAGES',
        'MARKET':'THE MARKET','CLOTHES':'CLOBBER',
        'JACKET':'CLOBBER','COAT':'KECKS','SHIRT':'KECKS',
        'TROUSERS':'KECKS','JEANS':'JEANS LA','SHORTS':'KEKS',
        'SHOES':'TRABS','TRAINERS':'TRABS','BOOTS':'TRABS',
        'SOCKS':'SOCKS LA','HAT':'BENNY',
        'SCHOOL':'SCOOL','UNIVERSITY':'UNI','COLLEGE':'COLLEGE LA',
        'WORK':'GRAFT','JOB':'GRAFT','CAREER':'GRAFT',
        'HOSPITAL':'THE OZZY','DOCTOR':'THE DOC',
        'CHURCH':'CHAPEL','PARK':'THE PARK LA',
        'BEACH':'THE BEACH','RIVER':'THE RIVER',
        'CITY':'THE CITY','TOWN':'TOWN','LIVERPOOL':'POOL',
        'FOOTBALL':'FOOTY','GOAL':'GOAL LA','MATCH':'GAME',
        'TEAM':'TEAM LA','PLAYER':'PLAYER LA',
        'MUSIC':'TUNES','CONCERT':'GIG','FESTIVAL':'FESTIE',
        /* ── Common Scouse expressions ── */
        'WHAT':'WHA','NOTHING':'NOWT','SOMETHING':'SUMMAT','ANYTHING':'OWT',
        'EVERYTHING':'EVERYTHIN','EVERYONE':'EVERYONE LA',
        'SOMEWHERE':'SOMEWHERE LA','NOWHERE':'NOWHERE LA',
        'LITTLE':'LITTL\'UN','BIG':'MASSIVE','LARGE':'MASSIVE',
        'SMALL':'TITCHY','TINY':'TITCHY',
        'OLD':'OLD LIKE','YOUNG':'YOUNG LIKE','NEW':'BRAND NEW',
        'LONG':'WELL LONG','SHORT':'WELL SHORT',
        'FULL':'STUFFED','EMPTY':'EMPTY LA',
        'OPEN':'OPEN','SHUT':'SHUTTERED',
        'HERE':'ERE','THERE':'OVER THERE','WHERE':'WHERE LA',
        'NOW':'RIGHT NOW','THEN':'THEN LA','WHEN':'WHEN LA',
        'TODAY':'TODAY LA','TOMORROW':'TOMORRER','YESTERDAY':'YESTY',
        'MORNING':'MORNIN','AFTERNOON':'ARVO','EVENING':'EVENIN',
        'NIGHT':'NIGH','WEEK':'WEEK LA','MONTH':'MONTH LA','YEAR':'YEAR LA',
        'ALWAYS':'ALWAYS LA','NEVER':'NEVER EVER','SOMETIMES':'SOMETIMES LIKE',
        'OFTEN':'LOADS','EVERY':'EVERY LA',
        'WITH':'WID','WITHOUT':'WITHOUT LA','ABOUT':'ABOUT LA',
        'BECAUSE':'COZZ','SINCE':'SINCE LIKE','ALTHOUGH':'EVEN THOUGH',
        'BUT':'BUT LIKE','AND':'AND LA','OR':'OR LA',
        'IF':'IF LIKE','WHILE':'WHILE LIKE',
        'PROBLEM':'MARE','TROUBLE':'MARE','ISSUE':'MARE LA',
        'MESS':'RIGHT MESS','DISASTER':'ABSOLUTE MARE',
        'EASY':'SIMPLE AS','HARD':'PROPER ARD','DIFFICULT':'PROPER ARD',
        'CHANCE':'SHOT','OPPORTUNITY':'CHANCE LA',
        'IDEA':'IDEA LA','PLAN':'PLAN LA',
        'TRUE':'REAL TALK','FALSE':'BALLS','LIE':'TELL A PORKY',
        'SERIOUS':'STRAIGHT UP','IMPORTANT':'PROPER IMPORTANT',
        'SPECIAL':'WELL SPECIAL','RARE':'WELL RARE',
        'NORMAL':'NORMAL LIKE','COMMON':'DEAD COMMON',
        'PRIVATE':'PRIVATE LIKE','SECRET':'BETWEEN YOU AND ME LA',
        'FAMOUS':'WELL KNOWN','POPULAR':'DEAD POPULAR',
        'POWER':'CLOUT','STRENGTH':'MUSCLE',
        'LOVE':'LOVE YER LA','HATE':'CANT STAND',
        'RESPECT':'PROPER RESPECT','TRUST':'TRUST LA',
        /* ── Liverpool-specific expressions ── */
        'LEGEND':'ABSOLUTE LEGEND LA','HERO':'PROPER HERO',
        'BRILLIANT':'BELTER','CLASS':'CLASS LA','QUALITY':'QUALITY',
        'MARVELLOUS':'PROPER BOSS','SUPERB':'BOSS THAT LA',
        'TERRIBLE':'SHOCKIN','DREADFUL':'SHOCKIN LA',
        'DISASTER':'MARE','CATASTROPHE':'ABSOLUTE MARE',
        'NONSENSE':'GOBSHITE','RUBBISH':'GUFF',
        'EXCUSE':'BLAG','BLUFF':'BLAG','LIE':'BLAG',
        'COMPLAIN':'MOAN','MOANING':'MOANIN ON',
        'GOSSIP':'SCUTTLE','RUMOUR':'SCUTTLE LA',
        'LAUGH':'AVE THE CRACK','FUN':'THE CRACK','BANTER':'THE CRACK',
        'JOKE':'HAVIN A LAUGH','PRANK':'WINDUP',
        'CELEBRATE':'AVE A DO','PARTY':'DO',
        'TOGETHER':'ALL TOGETHER LA','ALONE':'ON YER OWN',
        'HOME':'GAFF','AWAY':'OVER THERE'
    };

    function toScouse(text) {
        if (!text) return '';
        return translateWithDict(text.toUpperCase(), SCOUSE_DICT);
    }

    /* ── Napoletano (Neapolitan dialect) dictionary ───────────────────── */
    /* Neapolitan is a full Romance language spoken in Naples and Campania.
       Key features: 'O/'A/'E as articles, dropped final vowels, ND→NN,
       MB→MM, double consonants, unique vocabulary from Greek/Spanish/Arabic. */
    var NAP_DICT = {
        /* ── Multi-word phrases ── */
        'HOW ARE YOU':'COMM\' STAJE','ARE YOU WELL':'STAJE BUONO',
        'GOOD MORNING':'BUONGIORNO','GOOD AFTERNOON':'BUONPOMERIGGIO',
        'GOOD EVENING':'BONASERA','GOOD NIGHT':'BUONANOTTE',
        'THANK YOU':'GRAZIE ASSAJE','THANK YOU VERY MUCH':'GRAZIE MILLE',
        'YOU ARE WELCOME':'PREGO','HOW BEAUTIFUL':'CHE BELLEZZA',
        'MY LOVE':'AMMORE MIO','MY HEART':'CORE MIO',
        'OH GOD':'MANNAGGIA','OH MY GOD':'MANNAGGIA A MAMMETA',
        'COME HERE':'VIENI CCA','GET OUT':'LEVATE A MMIEZO',
        'WHAT ARE YOU DOING':'CHE STAJE FACENNO',
        'I DO NOT KNOW':'NON SACCIO','I KNOW':'SACCIO',
        'I WANT':'VOGLIO','I NEED':'ME SERVE',
        'I AM HUNGRY':'HO FAMME','I AM THIRSTY':'HO SETE',
        'I AM TIRED':'SO\' STANCO MUORTO','I AM HAPPY':'SO\' CUNTENTO',
        'I AM ANGRY':'SO\' ARRABIATO','I AM SCARED':'HO PAURA',
        'I LOVE YOU':'TE VOGLIO BENE','I MISS YOU':'ME MANCHI',
        'BE CAREFUL':'STATTE ATTIENTO','HURRY UP':'SBRIGATE',
        'NO WAY':'MANCO PE\' NIENTE','OF COURSE':'CERTAMENTE',
        'WHAT A MESS':'CHE CASINO','WHAT A PITY':'CHE PECCATO',
        'SO MUCH':'ASSAJE ASSAJE','A LOT':'N\'SACCO',
        'FOR REAL':'PE\' DAVERO','ARE YOU SERIOUS':'SUL SERIO',
        'WELL DONE':'BRAVO','SHUT UP':'TAZZE T\' A BOCCA',
        'GO AWAY':'LEVATE','LEAVE ME ALONE':'LASSAME STARE',
        'HOW MUCH':'QUANTO COSTA','HOW MANY':'QUANTA NNE VVUO\'',
        'WHAT IS YOUR NAME':'COMM\' TE CHIAME',
        'WHERE ARE YOU FROM':'ADDÒ VIENE',
        'WHERE IS IT':'ADDÒ STA','WHERE ARE YOU':'ADDÒ STAJE',
        'WHAT TIME IS IT':'CHE ORE SONO',
        /* ── Greetings ── */
        'HELLO':'AJÒ','HI':'AJÒ','HEY':'AJÒ','YO':'AJÒ',
        'BYE':'AJÒ','GOODBYE':'ARRIVEDERCI','FAREWELL':'ADDIÒ',
        'SEE YOU':'A PRESTO','LATER':'DOPPO','SOON':'SUBETO',
        'THANKS':'GRAZIE','THANK':'GRAZIE',
        'PLEASE':'PE PIACERE','SORRY':'SCUSAME',
        'EXCUSE ME':'PERMESSO','PARDON':'SCUSATE',
        'YES':'SÌ','NO':'NÒ','MAYBE':'FORZE','SURE':'CERTAMENTE',
        'OK':'VA BUONO','FINE':'TUTTO BENE','AGREED':'D\'ACCORDO',
        'WELCOME':'BENVENUTO','CHEERS':'SALUTE',
        /* ── People & family ── */
        'BOY':'GUAGLIONE','GIRL':'GUAGLIUNCELLA',
        'BOYS':'GUAGLIUNE','GIRLS':'GUAGLIUNCELLE',
        'CHILD':'PICCERILLO','CHILDREN':'PICCERILLI','BABY':'BAMBINO',
        'MAN':'OMO','WOMAN':'FEMMENA','MEN':'UOMMENE','WOMEN':'FEMMENE',
        'PERSON':'PERSONA','PEOPLE':'GENTE',
        'YOUNG':'GIOVANE','OLD MAN':'VECCHIO','OLD WOMAN':'VECCHIA',
        'MOTHER':'MAMMETA','MUM':'MAMMA','MOM':'MAMMA',
        'FATHER':'TATÀ','DAD':'PAPÀ','POP':'TATÀ',
        'BROTHER':'FRATEMO','SISTER':'SIEREMA',
        'GRANDMOTHER':'NONNA','GRANDFATHER':'NONNO',
        'AUNT':'ZIA','UNCLE':'ZIO','COUSIN':'CUGINO',
        'SON':'FIGLIO','DAUGHTER':'FIGLIA',
        'HUSBAND':'MARITO','WIFE':'MOGLIERA',
        'BOYFRIEND':'FIDANZATO','GIRLFRIEND':'FIDANZATA',
        'FRIEND':'AMICO MIO','FRIENDS':'AMICI','PAL':'COMPAGNO',
        'ENEMY':'NEMICO','NEIGHBOUR':'VICINO DI CASA',
        'BOSS':'PADRONE','CHIEF':'CAPPO',
        'KING':'RE','QUEEN':'REGINA','SAINT':'SANTO',
        /* ── Body ── */
        'HEAD':'CAPO','FACE':'FACCIA','EYES':'UOCCHIE','EYE':'UOCCHIO',
        'MOUTH':'VOCCA','NOSE':'NASO','EAR':'RECCHIA','EARS':'RECCHIE',
        'HAND':'MANO','HANDS':'MMANE','FOOT':'PIEDE','FEET':'PIEDE',
        'HEART':'CORE','SOUL':'ANEMA','BODY':'CUORPO',
        'HAIR':'CAPILLE','TEETH':'DIENTE','BLOOD':'SANGHE',
        /* ── Emotions & qualities ── */
        'GOOD':'BUONO','GREAT':'ASSAJE BUONO','EXCELLENT':'MAGNIFICO',
        'WONDERFUL':'MERAVIGLIOSO','FANTASTIC':'FANTASTICO',
        'BEAUTIFUL':'BELLISSIMO','UGLY':'BRUTTO',
        'HANDSOME':'BELLO E BUONO','PRETTY':'CARINO',
        'HAPPY':'CUNTENTO','JOY':'ALLEGRIA','LOVE':'AMMORE',
        'SAD':'MALANCUNICO','MELANCHOLY':'MALINCONICO',
        'ANGRY':'ARRABIATO','RAGE':'RABBIA','FURY':'FURORE',
        'SCARED':'SPAVENTATO','FEAR':'PAURA',
        'NERVOUS':'NERVOSO','WORRIED':'PREOCCUPATO',
        'PROUD':'ORGOGLIOSO','SHAME':'VERGOGNA',
        'JEALOUS':'GELOSO','ENVY':'MMIRIA',
        'TIRED':'STANCO MUORTO','EXHAUSTED':'SFIANCATO',
        'SICK':'MALATO','ILL':'MUORTO E AMMAZZATO',
        'DRUNK':'MBRIACO','HUNGOVER':'APPESANTITO',
        'CRAZY':'PAZZO','MAD':'PAZZARELLO','FOOLISH':'SCEMO',
        'LAZY':'PIGRO','SERIOUS':'SERIO',
        'STUPID':'CIUCCIO','IDIOT':'FESSO','FOOL':'CRETINO',
        'SMART':'INTELLIGENTE','WISE':'SAGGIO',
        'STRONG':'FORTE','WEAK':'DEBOLE',
        'VERY':'ASSAJE','REALLY':'VERAMENTE','EXTREMELY':'TROPPO',
        'TOO MUCH':'ASSAJE TROPPO','ENOUGH':'ABBASTANZA',
        'LITTLE':'POCO','MUCH':'ASSAJE','MANY':'TANTE',
        'ALL':'TUTTO','NOTHING':'NIENTE','SOME':'N\'PO\'',
        /* ── Actions ── */
        'EAT':'MAGNÀ','EATING':'STAJE MAGNANNE','ATE':'AVE MAGNATO',
        'DRINK':'BEVÌ','DRINKING':'STAJE BEVENNO',
        'COOK':'CUCENÀ','COOKING':'STAJE CUCENANNE',
        'COME':'VENE','COMING':'STAJE VENNENNO','CAME':'SONGO VENUTO',
        'GO':'JÀ','GOING':'STAJE JENNNO','WENT':'SO GHIUTO',
        'RUN':'SCAPPA','RUNNING':'STAJE SCAPPENNO',
        'WALK':'CAMMINA','WALKING':'STAJE CAMMINANNO',
        'STOP':'FERMATE','WAIT':'ASPETTA','HURRY':'SBRIGATE',
        'SPEAK':'PARLA','TALK':'PARRÀ','SHOUT':'ZUCA',
        'LISTEN':'SENTE','HEAR':'ASCOLTA','UNDERSTAND':'CAPISCE',
        'SEE':'VEDE','LOOK':'GUARDA','WATCH':'TENE UOCCHIO',
        'KNOW':'SACCIO','THINK':'PENZO','BELIEVE':'CRERE',
        'WANT':'VOGLIO','NEED':'ME SERVE','LIKE':'ME PIACE',
        'LOVE':'AMO','HATE':'ODIO','MISS':'ME MANCHI',
        'WORK':'FATICÀ','REST':'RIPOSA','SLEEP':'DORMI',
        'WAKE':'SVEGLIETE','PLAY':'GIOCA','SING':'CANTA','DANCE':'VALLA',
        'WRITE':'SCRIVE','READ':'LEGGE','STUDY':'STUDIA',
        'BUY':'ACCATTA','SELL':'VENDE','PAY':'PAGA',
        'GIVE':'DA','TAKE':'PIGGLIA','BRING':'PORTA',
        'OPEN':'APRE','CLOSE':'CHIUDE','BREAK':'ROMPE',
        'HELP':'AIUTA','FIGHT':'LITIGÀ','LAUGH':'RIDE',
        'CRY':'CHIAGNE','SMILE':'SORRIRE','KISS':'VASA',
        'HUG':'ABBRACCIA','PUSH':'SPIGNE','PULL':'TIRA',
        'THROW':'LANZA','HIT':'BATTE','KICK':'CALCIA',
        'WIN':'VINCE','LOSE':'PERDE','TRY':'PROVA',
        'ARRIVE':'ARRIVA','LEAVE':'PARTE','RETURN':'TORNA',
        'START':'INIZIA','FINISH':'FINISCE','CONTINUE':'CONTINUA',
        /* ── Things & places ── */
        'FOOD':'ROBA DA MAGNÀ','MEAL':'PASTO','BREAD':'PANE',
        'PIZZA':'PIZZA A VERACE','PASTA':'PASTA','RICE':'RISO',
        'FISH':'PESCE','MEAT':'CARNE','VEGETABLE':'VERDURA',
        'FRUIT':'FRUTTA','TOMATO':'PUMMAROLA','GARLIC':'AGLIO',
        'OIL':'UOGLIO','SALT':'SALE','CHEESE':'FORMAGGIO',
        'MOZZARELLA':'MOZZARELLA','RAGÙ':'RAGÙ O\'NAPOLETANO',
        'COFFEE':'CAFÈ','ESPRESSO':'CAFÈ ESPRESSO',
        'WATER':'ACQUA','WINE':'VINO','BEER':'BIRRA','MILK':'LATTE',
        'MONEY':'SOLDE','COIN':'MONETA','PRICE':'PREZZO',
        'HOUSE':'CASA','HOME':'CASA MIA','APARTMENT':'APPARTAMENTO',
        'ROOM':'CAMERA','KITCHEN':'CUCINA','BATHROOM':'BAGNO',
        'STREET':'STRÀ','ROAD':'VIA','ALLEY':'VICO','SQUARE':'PIAZZA',
        'MARKET':'MERCATO','SHOP':'NEGOZIO','BAR':'BARO',
        'CHURCH':'CHIESA','MUSEUM':'MUSEO',
        'PORT':'PORTO','SEA':'MARE','BEACH':'SPIAGGIA','ISLAND':'ISOLA',
        'MOUNTAIN':'MUNTAGNA','VOLCANO':'VESUVIO','SUN':'SOLE',
        'MOON':'LUNA','STAR':'STELLA','SKY':'CIELO',
        'RAIN':'PIOGGIA','WIND':'VENTO','SNOW':'NEVE',
        'DAY':'JUORNO','NIGHT':'NOTTE','MORNING':'MATINA',
        'AFTERNOON':'POMERIGGIO','EVENING':'SERA',
        'TODAY':'OGGI','TOMORROW':'DIMANE','YESTERDAY':'IERI',
        'TIME':'TIEMPO','HOUR':'ORA','MINUTE':'MINUTO',
        'WEEK':'SETTIMANA','MONTH':'MESE','YEAR':'ANNO',
        'POLICE':'GUARDIE','CARABINIERI':'CARABINIERE',
        'DOCTOR':'MEDICO','HOSPITAL':'OSPEDALE',
        'SCHOOL':'SCOLA','UNIVERSITY':'UNIVERSITÀ',
        'WORK':'FATIGA','JOB':'LAVORO',
        'SONG':'CANZONE','MUSIC':'MUSICA','DANCE':'BALLO',
        'FOOTBALL':'CALCIO','SPORT':'SPORT',
        'CAR':'MACCHINA','BUS':'AUTOBUS','TRAIN':'TRENO',
        'TELEPHONE':'TELEFONO','TELEVISION':'TELEVISIONE',
        'MONEY':'SOLDE','BANK':'BANCA',
        /* ── Strong Neapolitan expressions ── */
        'WOW':'UAGLIÒ','DAMN':'MANNAGGIA','HELL':'MALEDIZIONE',
        'PROBLEM':'GUAIO','TROUBLE':'CASINO','MESS':'CASINO',
        'LUCK':'FORTUNA','UNLUCKY':'SFIGATO',
        'FATE':'DESTINO','DESTINY':'FATO',
        'BLOOD':'SANGHE','HONOUR':'ONORE','FAMILY':'FAMIGLIA',
        'RESPECT':'RISPETTO','DIGNITY':'DIGNITÀ',
        'LIFE':'VITA','DEATH':'MORTE','GOD':'DDIO',
        'MADONNA':'MADONNA','SAINT':'SANTO',
        'NAPLES':'NAPULE','NEAPOLITAN':'NAPOLETANO',
        'BEAUTIFUL NAPLES':'NAPULE BELLA','THE CITY':'A CITÀ',
        /* ── Italian-source keys (spoken Italian → Neapolitan) ── */
        'CIAO':'AJÒ','SALVE':'AJÒ','ARRIVEDERCI':'ARRIVEDERCI',
        'BUONGIORNO':'BUONGIORNO','BUONASERA':'BONASERA','BUONANOTTE':'BUONANOTTE',
        'GRAZIE':'GRAZIE ASSAJE','PREGO':'PREGO','SCUSA':'SCUSAME',
        'PER FAVORE':'PE PIACERE','PER PIACERE':'PE PIACERE',
        'SÌ':'SÌ','NO':'NÒ','FORSE':'FORZE','CERTO':'CERTAMENTE',
        'RAGAZZO':'GUAGLIONE','RAGAZZA':'GUAGLIUNCELLA',
        'BAMBINO':'PICCERILLO','BAMBINA':'PICCERELLA',
        'UOMO':'OMO','DONNA':'FEMMENA','PERSONA':'PERSONA',
        'MADRE':'MAMMETA','MAMMA':'MAMMA','PADRE':'TATÀ','PAPÀ':'TATÀ',
        'FRATELLO':'FRATEMO','SORELLA':'SIEREMA',
        'NONNA':'NONNA','NONNO':'NONNO','ZIA':'ZIA','ZIO':'ZIO',
        'MARITO':'MARITO','MOGLIE':'MOGLIERA',
        'AMICO':'AMICO MIO','AMICI':'AMICI',
        'TESTA':'CAPO','FACCIA':'FACCIA','OCCHIO':'UOCCHIO','OCCHI':'UOCCHIE',
        'BOCCA':'VOCCA','NASO':'NASO','MANO':'MANO','MANI':'MMANE',
        'CUORE':'CORE','ANIMA':'ANEMA',
        'BUONO':'BUONO','BELLO':'BELLISSIMO','BRUTTO':'BRUTTO',
        'FELICE':'CUNTENTO','TRISTE':'MALANCUNICO','ARRABBIATO':'ARRABIATO',
        'STANCO':'STANCO MUORTO','UBRIACO':'MBRIACO','PAZZO':'PAZZO',
        'MOLTO':'ASSAJE','TANTO':'N\'SACCO','POCO':'N\'PO\'',
        'TUTTO':'TUTTO','NIENTE':'NIENTE','QUALCOSA':'QUACOSA',
        'MANGIARE':'MAGNÀ','BERE':'BEVÌ','PARLARE':'PARLA',
        'ANDARE':'JÀ','VENIRE':'VENE','CORRERE':'SCAPPA',
        'ASPETTARE':'ASPETTA','LAVORARE':'FATICÀ','DORMIRE':'DORMI',
        'SAPERE':'SACCIO','VOLERE':'VOGLIO','CAPIRE':'CAPISCE',
        'GUARDARE':'GUARDA','SENTIRE':'SENTE',
        'CIBO':'ROBA DA MAGNÀ','PANE':'PANE','PIZZA':'PIZZA A VERACE',
        'PASTA':'PASTA','PESCE':'PESCE','CARNE':'CARNE',
        'CAFFÈ':'CAFÈ','ACQUA':'ACQUA','VINO':'VINO','BIRRA':'BIRRA',
        'SOLDI':'SOLDE','CASA':'CASA','STRADA':'STRÀ',
        'MARE':'MARE','SOLE':'SOLE','GIORNO':'JUORNO','NOTTE':'NOTTE',
        'OGGI':'OGGI','DOMANI':'DIMANE','IERI':'IERI',
        'NAPOLI':'NAPULE','CHE BELLO':'CHE BELLEZZA',
        'CHE COSA':'CHE COSA','COME STAI':'COMM\' STAJE',
        'TI VOGLIO BENE':'TE VOGLIO BENE','MI MANCHI':'ME MANCHI',
        'ANDIAMO':'JÀ','VAI':'JÀ','VIENI':'VENE',
        'ASPETTA':'ASPETTA','FERMATI':'FERMATE',
        'CHE CASINO':'CHE CASINO','CHE PECCATO':'CHE PECCATO',
        'BRAVO':'BRAVO','DAI':'AJÒ','MANNAGGIA':'MANNAGGIA'
    };

    function toNapoletano(text) {
        if (!text) return '';
        return translateWithDict(text.toUpperCase(), NAP_DICT);
    }

    /* ── Genovese/Zeneize dialect dictionary ──────────────────────────── */
    /* Zeneize is the Ligurian language of Genoa. Key features: mixed
       Occitan/Old French influence, maritime vocabulary, famous BELIN
       (universal emphatic), schèi for money (from "Scheidemünze"),
       special chars â/ê/î/ô/û/æ, article 'u (masc) / 'a (fem).
       Ciao itself derives from Genovese "s-ciau de vosignoría". */
    var GEN_DICT = {
        /* ── Multi-word phrases ── */
        'HOW ARE YOU':'COMM\' STÆ','ARE YOU WELL':'STÆ BEN',
        'GOOD MORNING':'BONGIORNO','GOOD AFTERNOON':'BONA SEUA',
        'GOOD EVENING':'BONASEIA','GOOD NIGHT':'BONANÖTTE',
        'THANK YOU':'GRÂSCIE MILLE','THANK YOU VERY MUCH':'GRÂSCIE ASSÆ',
        'YOU ARE WELCOME':'PRE PIAXEI','EXCUSE ME':'SCÛSA',
        'I DO NOT KNOW':'NON SÒ','I KNOW':'SÒ BEN',
        'I WANT':'VÖGIO','I NEED':'ME SERVE','I LIKE':'ME PIAXE',
        'I LOVE YOU':'TI VÖGIO BEN','I MISS YOU':'ME MANCHIE',
        'HOW MUCH':'QUANT\' COSTA','HOW MANY':'QUANTI',
        'WHERE IS':'DUVE L\'È','WHAT IS':'CHE L\'È',
        'WHAT ARE YOU DOING':'CHE FÆ','ARE YOU SERIOUS':'SUL SERIO',
        'COME HERE':'VEN CÂ','GO AWAY':'VA VIA','GET OUT':'LEVITE',
        'BE CAREFUL':'STÆ ATTENTO','HURRY UP':'SBRIGITE',
        'NO WAY':'GNANCA PE\' NINTE','OF COURSE':'CERTO CHE SÌ',
        'WHAT A PITY':'CHE PECCÂ','WHAT A SHAME':'CHE VERGÖGNA',
        'WELL DONE':'BRAVO','SHUT UP':'ZIETO','SHUT YOUR MOUTH':'SÊRA A BOCCA',
        'I AM HUNGRY':'HO FAME','I AM THIRSTY':'HO SÊ',
        'I AM TIRED':'SION STANCO','I AM HAPPY':'SION CONTENTO',
        'I LOVE':'AMO','I HATE':'ODIO',
        'OH MY GOD':'BELIN D\'UN DIO','WHAT THE HELL':'BELIN CHE COSA',
        'FOR REAL':'PE DAVEO','SO MUCH':'ASSÆ TANTO',
        'SEE YOU LATER':'A DOMAN','SEE YOU':'A REVEI',
        'GOOD LUCK':'BONA FORTUNA','TAKE CARE':'STÆ ATENTO',
        /* ── Greetings & responses ── */
        'HELLO':'CIAU','HI':'CIAU','HEY':'CIAU','YO':'CIAU',
        'BYE':'CIAU','GOODBYE':'ARVEI','FAREWELL':'ADDIÒ',
        'SEE YOU':'A REVEI','LATER':'DÒPO',
        'THANKS':'GRÂSCIE','THANK':'GRÂSCIE',
        'PLEASE':'PER PIAXEI','SORRY':'SCÛSEME',
        'PARDON':'SCÛSA','APOLOGIES':'SCÛSA BEN',
        'YES':'SÌ','NO':'NÒ','MAYBE':'FORSE','PERHAPS':'FORSCI',
        'SURE':'CERTO','DEFINITELY':'SICÛRO','ABSOLUTELY':'PROPPIO SÌ',
        'OK':'VA BEN','FINE':'TUTTO BEN','AGREED':'D\'ACCORDO',
        'EXACTLY':'PROPPIO GIUSTO','RIGHT':'GIUSTO',
        'WELCOME':'BENVENÛO','CHEERS':'SALUTE',
        'CONGRATULATIONS':'CONGRATÛLASCIOIN',
        /* ── People & family ── */
        'BOY':'TOSO','GIRL':'TOSA','BOYS':'TOSI','GIRLS':'TOSE',
        'CHILD':'FIOLETTO','CHILDREN':'FIOLETTI','BABY':'BAMBIN',
        'TODDLER':'PICCIN','INFANT':'NEONATO',
        'MAN':'OMO','WOMAN':'DONNA','MEN':'OMMI','WOMEN':'DONNE',
        'PERSON':'PERSONA','PEOPLE':'ZENTE','EVERYONE':'TUTTI',
        'YOUNG MAN':'ZOVENO','YOUNG WOMAN':'ZOVENA',
        'OLD MAN':'VEGIO','OLD WOMAN':'VEGIA',
        'MOTHER':'MOÆ','MOM':'MÆMA','MUM':'MÆMA','MAMA':'MÆMA',
        'FATHER':'PÂ','DAD':'PÂ','PAPA':'PÂ',
        'BROTHER':'FRÆ','SISTER':'SÒRELLA',
        'GRANDMOTHER':'NONNA','GRANDFATHER':'NÒNNO',
        'AUNT':'ZIA','UNCLE':'ZIO','COUSIN':'CÛGGINO',
        'SON':'FIOEU','DAUGHTER':'FIOUA','CHILD':'FIOEU',
        'HUSBAND':'MÂRITO','WIFE':'MUGGÊ',
        'BOYFRIEND':'FIDANSÂTO','GIRLFRIEND':'FIDANSÂTA',
        'FRIEND':'AMIGO','FRIENDS':'AMIGHI','COMPANION':'COMPAGNO',
        'ENEMY':'NEMIGO','NEIGHBOUR':'VESIN',
        'BOSS':'PADRON','MASTER':'MÆSTRO',
        'PRIEST':'PREVOSTO','SAILOR':'MARENÂ','FISHERMAN':'PESCÂ',
        'MERCHANT':'MERSANTE','BANKER':'BANCHÊ',
        /* ── Body ── */
        'HEAD':'TESTA','FACE':'FACIA','EYES':'EUGGI','EYE':'EUGGIO',
        'MOUTH':'BOCCA','NOSE':'NÂSO','EAR':'OREGGIA','EARS':'OREGGE',
        'HAND':'MAN','HANDS':'MANI','FOOT':'PIÈ','FEET':'PIÈ',
        'HEART':'CHEU','SOUL':'ANIMA','BODY':'CORPO',
        'HAIR':'CAVILLU','TEETH':'DENTI','BLOOD':'SANGUE',
        'ARM':'BRASC','LEG':'GAMBA','BACK':'SCHÊNA',
        /* ── Emotions & qualities ── */
        'GOOD':'BEN','GREAT':'ASSÆ BEN','EXCELLENT':'OTTIMO',
        'PERFECT':'PERFETO','WONDERFUL':'MERAVIGLIOZO',
        'FANTASTIC':'FANTASTICO','MAGNIFICENT':'MAGNIFICO',
        'BEAUTIFUL':'BELL-A','UGLY':'BRUTTO',
        'HANDSOME':'BELL-O','PRETTY':'CARINO',
        'HAPPY':'CONTENTO','JOY':'GIOIA','PLEASURE':'PIAXEI',
        'SAD':'TRIST','MELANCHOLY':'MALINCONICO',
        'ANGRY':'ARRABIÂ','FURIOUS':'FURIBONDO',
        'CALM':'CÂLMO','PEACEFUL':'PACIFICO',
        'SCARED':'SPAVENTÂ','FEAR':'PAÛA',
        'NERVOUS':'NERVÔZO','WORRIED':'PREOCÛPÂ',
        'PROUD':'ORGOGLIOZO','SHAME':'VERGÖGNA',
        'JEALOUS':'GELÔZO','ENVY':'INVIDIA',
        'TIRED':'STANCO','EXHAUSTED':'SFINÎO',
        'SICK':'AMÂLÂ','ILL':'MALÂTO',
        'DRUNK':'BRILLO','TIPSY':'MEZZO BRILLO','HUNGOVER':'APPESANTÎO',
        'CRAZY':'MATO','MAD':'MATTOIDE','FOOLISH':'MINCION',
        'LAZY':'PIGRASSO','SERIOUS':'SERIO',
        'STUPID':'BELIN','IDIOT':'BESTA','FOOL':'MINCION',
        'SMART':'INTELLIGENTE','CLEVER':'FURBO','WISE':'SAGGIO',
        'STRONG':'FORTE','WEAK':'DEBOLE','TOUGH':'DUR',
        'KIND':'GENTILE','MEAN':'CATTIVO','GENEROUS':'GENERÔZO',
        'HONEST':'ONESTO','LIAR':'BUGIARDO',
        'LUCKY':'FORTUNÂ','UNLUCKY':'SFIGÂ',
        'RICH':'RICCO','POOR':'PÔVERO','WEALTHY':'BENESTANTE',
        'VERY':'ASSÆ','REALLY':'PROPPIO','EXTREMELY':'TROPPO',
        'TOO MUCH':'TROPPO ASSÆ','ENOUGH':'ABBASTANSA',
        'LITTLE':'POCO','MUCH':'ASSÆ','MANY':'TANTI',
        'ALL':'TUTTO','NOTHING':'GNENTE','SOME':'UN PO\'',
        'BIG':'GRANDO','LARGE':'GRANDE','SMALL':'PICCIN','TINY':'MINÛSCOLO',
        'LONG':'LUNGO','SHORT':'CURTO','TALL':'AUTO','FAT':'GROSSO',
        'FAST':'LESTO','QUICK':'SPICCIATIVO','SLOW':'LENTO',
        'HOT':'CÀIDO','WARM':'TEPPIO','COLD':'FRIDO','FREEZING':'GELÄO',
        'OLD':'VEGIO','YOUNG':'ZOVENO','NEW':'NEUVO','ANCIENT':'ANTICO',
        'CLEAN':'NETO','DIRTY':'SPORCO','DARK':'SCÛRO','LIGHT':'CIARO',
        'FULL':'PIEN','EMPTY':'VÒDO','OPEN':'AERTO','CLOSED':'SÊRÂO',
        /* ── Actions ── */
        'EAT':'MANGIÂ','EATING':'STÆ MANGIANDO','ATE':'HO MANGIÂ',
        'DRINK':'BEVVE','DRINKING':'STÆ BEVENNO',
        'COOK':'CUSCINÂ','COOKING':'STÆ CUSCINANDO',
        'COME':'VEGNÎ','COMING':'VEGNINDO','CAME':'SÒ VEGNÛO',
        'GO':'ANDÂ','GOING':'ANDANDO','WENT':'SÒ ANDÂO',
        'RUN':'CÛRRE','RUNNING':'CÛRRENDO',
        'WALK':'CAMMINÂ','WALKING':'CAMMINANDO',
        'STOP':'FERMITE','WAIT':'ASPETÂ','HURRY':'SPICCIÂTI',
        'SPEAK':'PARLÂ','TALK':'DISCÛRRE','CHAT':'CIÂCIARÂ',
        'SHOUT':'BERCIÂ','WHISPER':'BISBIZIÂ',
        'LISTEN':'SENTÎ','HEAR':'ASCOLTÂ','UNDERSTAND':'CAPÎ',
        'SEE':'VEIÂ','LOOK':'GARDÂ','WATCH':'STÂ ATTENTO',
        'KNOW':'SÒ','THINK':'PENSÂ','BELIEVE':'CREDDE',
        'WANT':'VÖGIO','NEED':'ME SERVE','LIKE':'ME PIAXE',
        'LOVE':'AMÂ','HATE':'ODIÂ','MISS':'ME MANCHIE',
        'WORK':'TRAVAGGIÂ','REST':'RIPOZÂ','SLEEP':'DORMÎ',
        'WAKE':'SVEGIÂSE','PLAY':'GIOCÂ','SING':'CANTÂ','DANCE':'BALLÂ',
        'WRITE':'SCRIVE','READ':'LEGGE','STUDY':'STUDIÂ',
        'BUY':'COMPRÂ','SELL':'VENDE','PAY':'PAGÂ',
        'GIVE':'DÂ','TAKE':'PIJÂ','BRING':'PORTÂ',
        'OPEN':'AVRÎ','CLOSE':'SÊRÂ','BREAK':'RÛPPE',
        'HELP':'AIUTÂ','FIGHT':'LITIGÂ','LAUGH':'RIDDE',
        'CRY':'PIANZE','SMILE':'SORRÎDE','KISS':'BASÂ',
        'HUG':'ABBRACIÂ','PUSH':'SPIGNE','PULL':'TIRÂ',
        'WIN':'VINCÎ','LOSE':'PERDE','TRY':'PROVÂ',
        'ARRIVE':'RIVÂ','LEAVE':'PARTÎ','RETURN':'TORNÂ',
        'START':'INIZIÂ','FINISH':'FINÎ','CONTINUE':'CONTINUÂ',
        'SWIM':'NOTÂ','SAIL':'NAVIGÂ','FISH':'PESCÂ',
        'CLIMB':'SCRAMPÂ','BUILD':'COSTRUÎ','CREATE':'CREÂ',
        /* ── Things & food/drink ── */
        'FOOD':'MANGIÂ','MEAL':'PASTO','BREAD':'PAN','PASTA':'PASTA',
        'PESTO':'PESTO','FOCACCIA':'FUGASSA','FARINATA':'FAINÂ',
        'FISH':'PEXE','ANCHOVIES':'ACCIUGHE','STOCKFISH':'STOCÂFISSO',
        'MEAT':'CARNE','CHICKEN':'POLASTRO','RABBIT':'CUNGIO',
        'CHEESE':'FROMAGGIO','PARMESAN':'PARMIGIAN',
        'TOMATO':'PUMÂDAMÔ','GARLIC':'AGLIO','ONION':'SIFÛLA',
        'OIL':'OUGIO','SALT':'SÂLE','PEPPER':'PEVERE',
        'MUSHROOM':'FUNGO','BASIL':'BAXEICÒ',
        'COFFEE':'CAFÈ','ESPRESSO':'CAFÈ','WATER':'ÆGUA',
        'WINE':'VIÑN','WHITE WINE':'VIÑN BIANCHO',
        'BEER':'BIRRA','MILK':'LATE',
        /* ── Money (Genoa = birthplace of modern banking) ── */
        'MONEY':'SCHÈI','CASH':'SCHÈI CONTANTI','COIN':'MOÉDA',
        'PRICE':'PRESIO','COST':'COSTO','PAY':'PAGÂ',
        'BANK':'BANCCA','LOAN':'PRESITO','DEBT':'DEBITO',
        'RICH':'RICCO','POOR':'PÔVERO','PROFIT':'PROFITO',
        'INVEST':'INVESTÎ','TRADE':'TRAFICO',
        /* ── Places & maritime (Genoa = maritime republic) ── */
        'HOUSE':'CAZA','HOME':'CAZA MIA','APARTMENT':'APPARTAMENTO',
        'ROOM':'CAMERA','KITCHEN':'CÛXINA','BATHROOM':'BAGNO',
        'STREET':'CARROGGIO','ROAD':'VIA','ALLEY':'VICO','SQUARE':'PIASSA',
        'MARKET':'MERCAO','SHOP':'NEGOSSIO','PORT':'PORTO',
        'CHURCH':'ÇEXA','PALACE':'PALÄZZO','TOWER':'TÛRRE',
        'CASTLE':'CASTELO','CITY':'ÇITTÆ','TOWN':'PAIZE',
        'LIGHTHOUSE':'LANTERNA','HARBOUR':'PORTO',
        'SEA':'MÂ','OCEAN':'OSEANO','BEACH':'SPIAGGIA','COAST':'COSTA',
        'WAVE':'ONDA','TIDE':'MAREA','CURRENT':'CURENTE',
        'ISLAND':'IXUA','MOUNTAIN':'MONTAGNA','VALLEY':'VALE',
        'RIVER':'FIUME','LAKE':'LAGO',
        'SHIP':'NÂVE','BOAT':'BARCA','GALLEY':'GÄREA',
        'SAILOR':'MARENÂ','CAPTAIN':'CAPITANO','NAVIGATOR':'NAVIGATÔ',
        'COMPASS':'BUSSOLA','MAP':'MAPPA','ANCHOR':'ANÇORA',
        'SAIL':'VEA','ROPE':'CORDA','NET':'RETE',
        'MOON':'LUNA','STAR':'STEIA','SUN':'SOÔ','SKY':'ÇIELO',
        'WIND':'VENTO','STORM':'TEMPESTA','RAIN':'PIOEUVA',
        'CLOUD':'NÛVOLA','FOG':'NEBBIA','SNOW':'NEIVE',
        'DAY':'GIORNO','NIGHT':'NÖTTE','MORNING':'MATTIN',
        'AFTERNOON':'DÒPOPRANSO','EVENING':'SEIA',
        'TODAY':'ANCHEU','TOMORROW':'DOMAN','YESTERDAY':'IERI',
        'TIME':'TEMPO','HOUR':'OA','MINUTE':'MINÛTO',
        'WEEK':'SETTIMANNA','MONTH':'MEZE','YEAR':'ANNO',
        /* ── BELIN — the signature Genovese exclamation ── */
        /* Used for surprise, emphasis, frustration, punctuation — everything */
        'WOW':'BELIN','DAMN':'BELIN','REALLY':'BELIN',
        'SERIOUSLY':'BELIN SERIO','INCREDIBLE':'BELIN CHE ROBA',
        'AMAZING':'BELIN CHE BELLO','UNBELIEVABLE':'BELIN CHE COSA',
        'WHAT':'BELIN CHE COZA','NONSENSE':'BELIN DE COSE',
        /* ── Common expressions ── */
        'PROBLEM':'PIÑA','TROUBLE':'PROBLEMA','MESS':'CASINO',
        'DISASTER':'DISASTRO','CATASTROPHE':'CATASTROFE',
        'EASY':'FÄSILE','HARD':'DIFFISSILE','DIFFICULT':'ARDU',
        'IMPORTANT':'IMPORTANTE','SPECIAL':'SPESIÂLE',
        'FUNNY':'DIVERTENTE','BORING':'NOIÔZO',
        'INTERESTING':'INTERESSANTE','STRANGE':'STRÂÑO',
        'NORMAL':'NORMALE','COMMON':'COMUNE',
        'TRUE':'VERO','FALSE':'FALSO','LIE':'BUGIA',
        'SECRET':'SEGRETO','PRIVATE':'PRIVATO',
        'GENOA':'ZENOVA','GENOESE':'ZENEIZE','LIGURIAN':'LIGÛRE',
        /* ── Italian-source keys (spoken Italian → Genovese/Zeneize) ── */
        'CIAO':'CIAU','SALVE':'CIAU','ARRIVEDERCI':'ARVEI',
        'BUONGIORNO':'BONGIORNO','BUONASERA':'BONASEIA','BUONANOTTE':'BONANÖTTE',
        'GRAZIE':'GRÂSCIE','PREGO':'PRE PIAXEI','SCUSA':'SCÛSEME',
        'PER FAVORE':'PER PIAXEI','PER PIACERE':'PER PIAXEI',
        'SÌ':'SÌ','NO':'NÒ','FORSE':'FORSE','CERTO':'CERTO',
        'RAGAZZO':'TOSO','RAGAZZA':'TOSA','BAMBINO':'FIOLETTO',
        'UOMO':'OMO','DONNA':'DONNA','PERSONA':'PERSONA','GENTE':'ZENTE',
        'MADRE':'MOÆ','MAMMA':'MÆMA','PADRE':'PÂ','PAPÀ':'PÂ',
        'FRATELLO':'FRÆ','SORELLA':'SÒRELLA',
        'NONNA':'NONNA','NONNO':'NÒNNO','ZIA':'ZIA','ZIO':'ZIO',
        'MARITO':'MÂRITO','MOGLIE':'MUGGÊ',
        'AMICO':'AMIGO','AMICI':'AMIGHI','VICINO':'VESIN',
        'TESTA':'TESTA','FACCIA':'FACIA','OCCHIO':'EUGGIO','OCCHI':'EUGGI',
        'BOCCA':'BOCCA','NASO':'NÂSO','MANO':'MAN','MANI':'MANI',
        'CUORE':'CHEU','ANIMA':'ANIMA',
        'BUONO':'BEN','BELLO':'BELL-O','BRUTTO':'BRUTTO',
        'FELICE':'CONTENTO','TRISTE':'TRIST','ARRABBIATO':'ARRABIÂ',
        'STANCO':'STANCO','UBRIACO':'BRILLO','PAZZO':'MATO',
        'MOLTO':'ASSÆ','TANTO':'ASSÆ TANTO','POCO':'POCO',
        'TUTTO':'TUTTO','NIENTE':'GNENTE','QUALCOSA':'QUARCÖSA',
        'MANGIARE':'MANGIÂ','BERE':'BEVVE','PARLARE':'PARLÂ',
        'ANDARE':'ANDÂ','VENIRE':'VEGNÎ','CORRERE':'CÛRRE',
        'ASPETTARE':'ASPETÂ','LAVORARE':'TRAVAGGIÂ','DORMIRE':'DORMÎ',
        'SAPERE':'SÒ','VOLERE':'VÖGIO','CAPIRE':'CAPÎ',
        'GUARDARE':'GARDÂ','SENTIRE':'SENTÎ','CANTARE':'CANTÂ',
        'CIBO':'MANGIÂ','PANE':'PAN','PESCE':'PEXE','CARNE':'CARNE',
        'PESTO':'PESTO','FOCACCIA':'FUGASSA','FARINATA':'FAINÂ',
        'CAFFÈ':'CAFÈ','ACQUA':'ÆGUA','VINO':'VIÑN','BIRRA':'BIRRA',
        'SOLDI':'SCHÈI','DENARO':'SCHÈI','CASA':'CAZA','STRADA':'CARROGGIO',
        'VICOLO':'VICO','PIAZZA':'PIASSA','PORTO':'PORTO','CHIESA':'ÇEXA',
        'MARE':'MÂ','SOLE':'SOÔ','LUNA':'LUNA','CIELO':'ÇIELO',
        'VENTO':'VENTO','PIOGGIA':'PIOEUVA','NEVE':'NEIVE',
        'GIORNO':'GIORNO','NOTTE':'NÖTTE','MATTINA':'MATTIN',
        'OGGI':'ANCHEU','DOMANI':'DOMAN','IERI':'IERI',
        'GENOVA':'ZENOVA','CHE BELLO':'BELIN CHE BELLO',
        'CHE COSA':'BELIN CHE COZA','COME STAI':'COMM\' STÆ',
        'TI VOGLIO BENE':'TI VÖGIO BEN','MI MANCHI':'ME MANCHIE',
        'ANDIAMO':'ANDÂ','DAI':'CIAU','VIENI':'VEN CÂ',
        'ASPETTA':'ASPETÂ','FERMATI':'FERMITE',
        'CHE CASINO':'BELIN CHE CASINO','CHE PECCATO':'CHE PECCÂ',
        'BRAVO':'BRAVO','BELIN':'BELIN'
    };

    function toGenovese(text) {
        if (!text) return '';
        return translateWithDict(text.toUpperCase(), GEN_DICT);
    }

    /* ── Target language codes for MyMemory (source is dynamic) ─────────── */
    // Keys match slot option values; values are the MyMemory target-side codes.
    var LANG_TARGETS = {
        EN: 'en', IT: 'it', NL: 'nl', ES: 'es', FR: 'fr',
        DE: 'de', ZH: 'zh', JA: 'ja', AR: 'ar'
    };

    /* ── Get 2-char source language from #vngrd-input-lang ──────────────── */
    function getSourceLangCode() {
        var sel = document.getElementById('vngrd-input-lang');
        if (!sel || !sel.value) return 'en';
        return sel.value.split('-')[0].toLowerCase(); // 'it-IT' → 'it', 'zh-CN' → 'zh'
    }

    /* ── Update the live-transcription HUD label ─────────────────────────── */
    function updateTranscriptionLabel() {
        var sel = document.getElementById('vngrd-input-lang');
        var lbl = document.getElementById('live-transcription-label');
        if (!lbl || !sel) return;
        var code = sel.value.split('-')[0].toUpperCase(); // 'it-IT' → 'IT'
        lbl.textContent = code + ' // LIVE TRANSCRIPTION';
    }

    /* ── DOM refs ─────────────────────────────────────────────────────── */
    var btnOnAir    = document.getElementById('btn-on-air');
    var mcrStatus   = document.getElementById('mcr-status');
    var mcrDot      = document.getElementById('mcr-on-air-dot');
    var subOverlay  = document.getElementById('vanguard-subtitles');
    var podcastTray = document.getElementById('podcast-tray');
    var hud         = document.getElementById('transcription-hud');
    var hudEN       = document.getElementById('hud-en-text');
    var slots       = [
        document.getElementById('slot-1'),
        document.getElementById('slot-2'),
        document.getElementById('slot-3'),
        document.getElementById('slot-4')
    ];
    // Tray box refs (dedicated labeled boxes)
    var traySlots    = [0,1,2,3].map(function(i) { return document.getElementById('tray-slot-' + i); });
    var trayLabels   = [0,1,2,3].map(function(i) { return document.getElementById('tray-label-' + i); });
    var trayTexts    = [0,1,2,3].map(function(i) { return document.getElementById('tray-text-' + i); });
    var btnSubOpacity = document.getElementById('btn-sub-opacity');
    var btnP2pStt     = document.getElementById('btn-p2p-stt');

    /* ── Slot state: cached translated text per slot ─────────────────── */
    var slotTexts = ['', '', '', ''];

    /* ── Subtitle background opacity cycle ────────────────────────────── */
    var subBgLevels = [0.67, 0.33, 0];
    var subBgIdx = 0;
    var subBgOpacity = subBgLevels[0];

    /* ── P2P STT routing ──────────────────────────────────────────────── */
    var p2pSTTMode = false;
    var p2pSTTCtx  = null;

    function getActiveSlots() {
        var active = [];
        slots.forEach(function(sel, i) {
            if (sel && sel.value !== 'OFF') active.push({ idx: i, lang: sel.value });
        });
        return active;
    }

    /* ── Direct canvas bake (belt-and-suspenders for all recording paths) ── */
    // Called whenever subtitle data changes so captureStream always gets a
    // fresh frame with subtitle text, independent of the renderLoop cycle.
    function _bakeSubtitlesToCanvas() {
        if (!window.APP || !APP.render || !APP.render.ctx) return;
        var ctx = APP.render.ctx;
        var w   = APP.render.width;
        var h   = APP.render.height;

        // ── 1. Translation slots (multi-language subtitle rows) ───────────
        var lines = window._vngrdSubtitleLines;
        if (lines && lines.length) {
            try {
                ctx.save();
                ctx.globalAlpha              = 1;
                ctx.globalCompositeOperation = 'source-over';
                ctx.filter                   = 'none';
                ctx.shadowBlur               = 0;
                ctx.textAlign                = 'center';
                ctx.textBaseline             = 'middle';
                var lineH    = Math.round(h * 0.058);
                var fsPx     = Math.round(h * 0.032);
                var padX     = 18;
                var blockH   = lineH * lines.length;
                var blockTop = Math.round(h * 0.78) - Math.round(blockH / 2);
                ctx.font = '700 ' + fsPx + 'px "Courier New",monospace';
                lines.forEach(function(sub, i) {
                    var lineTop = blockTop + i * lineH;
                    var cy      = lineTop + Math.round(lineH / 2);
                    var label   = '[' + sub.lang + '] ' + sub.text;
                    var tw      = ctx.measureText(label).width;
                    var bgA     = (typeof sub.bgAlpha === 'number') ? sub.bgAlpha : 0.8;
                    ctx.fillStyle = 'rgba(0,0,0,' + bgA + ')';
                    ctx.fillRect((w - tw) / 2 - padX, lineTop, tw + padX * 2, lineH);
                    ctx.fillStyle = '#00f3ff';
                    ctx.fillText(label, w / 2, cy);
                });
                ctx.restore();
            } catch (_) {}
        }

        // ── 2. Live transcription HUD (raw speech input line at bottom) ──
        var hudText = (hudEN ? hudEN.textContent : '').trim();
        if (hudText && onAir) {
            try {
                ctx.save();
                ctx.globalAlpha              = 1;
                ctx.globalCompositeOperation = 'source-over';
                ctx.filter                   = 'none';
                ctx.shadowBlur               = 0;
                ctx.textAlign                = 'center';
                ctx.textBaseline             = 'middle';
                var hudFsPx  = Math.round(h * 0.022);
                var hudLineH = Math.round(h * 0.038);
                var hudY     = Math.round(h * 0.955);
                var hudPadX  = 24;
                ctx.font = '400 ' + hudFsPx + 'px "Courier New",monospace';
                var srcCode  = getSourceLangCode().toUpperCase();
                var hudLabel = srcCode + ' // ' + hudText;
                var hudTw    = ctx.measureText(hudLabel).width;
                ctx.fillStyle = 'rgba(0,0,0,0.82)';
                ctx.fillRect((w - hudTw) / 2 - hudPadX, hudY - Math.round(hudLineH / 2), hudTw + hudPadX * 2, hudLineH);
                ctx.fillStyle = 'rgba(255,255,255,0.9)';
                ctx.fillText(hudLabel, w / 2, hudY);
                ctx.restore();
            } catch (_) {}
        }
    }

    // Expose for renderLoop — called every frame to keep canvas always up-to-date
    window._bakeSubtitlesToCanvas = _bakeSubtitlesToCanvas;

    /* ── UI helpers ───────────────────────────────────────────────────── */

    function setStatus(text, hot) {
        if (!mcrStatus) return;
        mcrStatus.textContent = text;
        mcrStatus.classList.toggle('hot', !!hot);
    }

    function renderSubtitles() {
        var active = getActiveSlots();

        // 1. Update podcast-tray dedicated boxes
        for (var i = 0; i < 4; i++) {
            var found = null;
            for (var j = 0; j < active.length; j++) {
                if (active[j].idx === i) { found = active[j]; break; }
            }
            if (found && slotTexts[i]) {
                if (traySlots[i])  traySlots[i].classList.remove('off');
                if (trayLabels[i]) trayLabels[i].textContent = found.lang;
                if (trayTexts[i]) {
                    trayTexts[i].textContent = slotTexts[i];
                    if (found.lang === 'AR') trayTexts[i].setAttribute('dir', 'rtl');
                    else                     trayTexts[i].removeAttribute('dir');
                }
            } else {
                if (traySlots[i])  traySlots[i].classList.add('off');
                if (trayLabels[i]) trayLabels[i].textContent = '--';
                if (trayTexts[i])  { trayTexts[i].textContent = ''; trayTexts[i].removeAttribute('dir'); }
            }
        }
        // Show tray if any slot has text
        var anyText = slotTexts.some(function(t) { return !!t; });
        if (podcastTray) podcastTray.classList.toggle('visible', anyText && onAir);

        // 2. Update broadcast overlay (#vanguard-subtitles)
        if (subOverlay) {
            subOverlay.innerHTML = '';
            // Font scale: shrink as more slots fill the overlay
            var fontSizes = [18, 16, 14, 12];
            var fontSize = fontSizes[Math.min(active.length, 4) - 1] || 16;
            // Compositor burn-in data
            window._vngrdSubtitleLines = [];
            active.forEach(function(s) {
                var text = slotTexts[s.idx];
                if (!text) return;
                var line = document.createElement('div');
                line.className = 'sub-line';
                if (s.lang === 'AR') line.setAttribute('dir', 'rtl');
                line.style.fontSize = fontSize + 'px';
                // Apply current background opacity
                var alpha = typeof subBgOpacity !== 'undefined' ? subBgOpacity : 0.67;
                line.style.background = 'rgba(0,0,0,' + alpha + ')';
                var langTag = document.createElement('span');
                langTag.className = 'sub-lang';
                langTag.textContent = s.lang;
                var body = document.createElement('span');
                body.className = 'sub-body';
                body.textContent = text;
                line.appendChild(langTag);
                line.appendChild(body);
                subOverlay.appendChild(line);
                window._vngrdSubtitleLines.push({ lang: s.lang, text: text, bgAlpha: alpha });
            });
            if (active.length === 0) window._vngrdSubtitleLines = [];
        }
        // Belt-and-suspenders: bake immediately onto the broadcast canvas so
        // captureStream captures a frame with subtitles on every text update.
        _bakeSubtitlesToCanvas();
    }

    function clearSubtitles() {
        slotTexts = ['', '', '', ''];
        window._vngrdSubtitleLines = [];   // clear canvas burn-in data
        if (subOverlay) subOverlay.innerHTML = '';
        if (podcastTray) podcastTray.classList.remove('visible');
        for (var i = 0; i < 4; i++) {
            if (traySlots[i])  traySlots[i].classList.add('off');
            if (trayLabels[i]) trayLabels[i].textContent = '--';
            if (trayTexts[i])  { trayTexts[i].textContent = ''; trayTexts[i].removeAttribute('dir'); }
        }
        if (hudEN) hudEN.textContent = '';
    }

    function setOnAirUI(active) {
        onAir = active;
        if (!btnOnAir) return;
        btnOnAir.textContent = active ? 'ON-AIR' : 'OFF-AIR';
        btnOnAir.classList.toggle('active', active);
        if (mcrDot) mcrDot.classList.toggle('hot', active);
        if (subOverlay) subOverlay.classList.toggle('visible', active);
        if (hud) hud.classList.toggle('hud-active', active);
        if (!active) clearSubtitles();
        setStatus(active ? 'STT: LIVE \u25B6' : 'STT: STANDBY', active);
        if (typeof ghostLog === 'function') {
            ghostLog(active ? 'GHOST> STT ENGINE ON-AIR (4-SLOT)' : 'GHOST> STT ENGINE OFFLINE', active ? 'ok' : 'ai');
        }
    }

    /* ── THE UNLIMITED ENGINE: GTX Bypass translation with debounce + cache ── */
    // Uses the Google Translate GTX endpoint (no API key required).
    // 200ms debounce prevents UI lag from rapid speech recognition updates.
    // window.transCache provides instant retrieval for repeated phrases.
    var _translateTimers = {};
    function translateText(text, src, target, slotIdx) {
        if (!text || !src || !target) return;
        var cacheKey = src + '|' + target + '|' + text;

        // 1. Cache hit: instant retrieval, no network call
        if (window.transCache && window.transCache[cacheKey]) {
            slotTexts[slotIdx] = window.transCache[cacheKey];
            renderSubtitles();
            if (typeof sendUISync === 'function') {
                var _p2p = {}; _p2p[target.toUpperCase()] = window.transCache[cacheKey];
                sendUISync('POLYTRANSLATOR', _p2p);
            }
            return;
        }

        // 2. Debounce 200ms to prevent rapid-fire fetches
        if (_translateTimers[slotIdx]) clearTimeout(_translateTimers[slotIdx]);
        _translateTimers[slotIdx] = setTimeout(function() {
            var url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' +
                src + '&tl=' + target + '&dt=t&q=' + encodeURIComponent(text);
            fetch(url)
                .then(function(res) { return res.json(); })
                .then(function(data) {
                    // GTX response: [[["translated","original",...],...],...]
                    var t = '';
                    if (data && data[0]) {
                        for (var i = 0; i < data[0].length; i++) {
                            if (data[0][i] && data[0][i][0]) t += data[0][i][0];
                        }
                    }
                    t = t.toUpperCase();
                    if (t) {
                        if (!window.transCache) window.transCache = {};
                        window.transCache[cacheKey] = t;
                        slotTexts[slotIdx] = t;
                        renderSubtitles();
                        // Push to P2P guests via dataChannel
                        if (typeof sendUISync === 'function') {
                            var _p2p = {}; _p2p[target.toUpperCase()] = t;
                            sendUISync('POLYTRANSLATOR', _p2p);
                        }
                    }
                })
                .catch(function() {});
        }, 200);
    }

    /* ── Process finalized text through all active slots ──────────────── */

    function processSlots(rawText) {
        if (!rawText) return;
        var srcCode = getSourceLangCode();          // 'en', 'it', 'zh', etc.
        var active  = getActiveSlots();
        var p2pData = {};
        p2pData[srcCode.toUpperCase()] = rawText;

        active.forEach(function(s) {
            // Dialect transforms — local dictionary, works from English or Italian source
            if (s.lang === 'SCOUSE') {
                slotTexts[s.idx] = (srcCode === 'en') ? toScouse(rawText) : rawText;
                p2pData['SCOUSE'] = slotTexts[s.idx];
                return;
            }
            if (s.lang === 'NAP') {
                slotTexts[s.idx] = (srcCode === 'en' || srcCode === 'it') ? toNapoletano(rawText) : rawText;
                p2pData['NAP'] = slotTexts[s.idx];
                return;
            }
            if (s.lang === 'GEN') {
                slotTexts[s.idx] = (srcCode === 'en' || srcCode === 'it') ? toGenovese(rawText) : rawText;
                p2pData['GEN'] = slotTexts[s.idx];
                return;
            }

            var tgtCode = LANG_TARGETS[s.lang];
            if (!tgtCode) return;                   // unknown slot lang, skip

            if (srcCode === tgtCode) {
                // Source and target are the same language — echo directly
                slotTexts[s.idx] = rawText;
                p2pData[s.lang]   = rawText;
            } else {
                // Different language — send via GTX Bypass with debounce + cache
                translateText(rawText, srcCode, tgtCode, s.idx);
                p2pData[s.lang] = '...';
            }
        });

        renderSubtitles();

        if (typeof sendUISync === 'function') {
            sendUISync('POLYTRANSLATOR', p2pData);
        }
    }

    /* ── Process interim text (real-time, no API calls) ──────────────── */

    function processInterim(text) {
        if (!text) return;
        var srcCode = getSourceLangCode();
        var active  = getActiveSlots();
        active.forEach(function(s) {
            if (s.lang === 'SCOUSE') {
                if (srcCode === 'en') slotTexts[s.idx] = toScouse(text);
                return;
            }
            if (s.lang === 'NAP') {
                if (srcCode === 'en' || srcCode === 'it') slotTexts[s.idx] = toNapoletano(text);
                return;
            }
            if (s.lang === 'GEN') {
                if (srcCode === 'en' || srcCode === 'it') slotTexts[s.idx] = toGenovese(text);
                return;
            }
            var tgtCode = LANG_TARGETS[s.lang];
            if (!tgtCode) return;
            // Only update slots whose language matches the source (no API on interim)
            if (srcCode === tgtCode) slotTexts[s.idx] = text;
            // Other langs: keep the last fully-translated text — no fetch on interim
        });
        renderSubtitles();
    }

    /* ── Speech Recognition Engine ────────────────────────────────────── */

    function buildRecognition() {
        var SpeechAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechAPI) {
            setStatus('STT: UNSUPPORTED');
            if (typeof ghostLog === 'function') ghostLog('STT: webkitSpeechRecognition not available in this browser', 'crit');
            return null;
        }
        var r = new SpeechAPI();
        r.continuous      = true;
        r.interimResults  = true;
        r.lang            = (document.getElementById('vngrd-input-lang') || {value: 'en-US'}).value;
        r.maxAlternatives = 1;

        r.onstart = function () {
            setStatus('STT: LIVE \u25B6', true);
            if (typeof ghostLog === 'function') ghostLog('GHOST> STT listening\u2026', 'ok');
        };

        r.onresult = function (e) {
            var interim = '';
            var finalText = '';
            for (var i = e.resultIndex; i < e.results.length; i++) {
                var transcript = e.results[i][0].transcript.trim().toUpperCase();
                if (e.results[i].isFinal) { finalText += transcript + ' '; }
                else                       { interim   += transcript;       }
            }
            // HUD always shows English live text
            var display = (finalText || interim).trim();
            if (hudEN) hudEN.textContent = display;

            if (finalText.trim()) {
                lastFinal = finalText.trim();
                processSlots(lastFinal);
            } else if (interim) {
                processInterim(interim);
            }
        };

        r.onerror = function (e) {
            if (e.error === 'no-speech') return;
            if (e.error === 'aborted') return;
            setStatus('STT_ERR: ' + e.error.toUpperCase());
            if (typeof ghostLog === 'function') ghostLog('STT ERR: ' + e.error, 'crit');
        };

        r.onend = function () {
            // _langSwitching = true means the change listener is rebuilding a fresh
            // instance — do NOT attempt to restart this dead one.
            if (onAir && !_langSwitching) {
                setTimeout(function() {
                    if (onAir && !_langSwitching) { try { r.start(); } catch(ex) {} }
                }, 250);
            } else if (!onAir) {
                setStatus('STT: STANDBY');
            }
            // else: _langSwitching is true — stay silent, let the change listener handle it
        };

        return r;
    }

    /* ── ON-AIR toggle ────────────────────────────────────────────────── */
    if (btnOnAir) {
        btnOnAir.addEventListener('click', function () {
            if (!onAir) {
                recognition = buildRecognition();
                if (!recognition) return;
                try {
                    recognition.start();
                    setOnAirUI(true);
                } catch (e) {
                    setStatus('STT_ERR: START_FAIL');
                    if (typeof ghostLog === 'function') ghostLog('STT START ERR: ' + e.message, 'crit');
                }
            } else {
                setOnAirUI(false);
                if (recognition) { try { recognition.stop(); } catch(ex) {} recognition = null; }
            }
        });
    }

    /* ── Input language live switching ───────────────────────────────── */
    var _inputLangSel = document.getElementById('vngrd-input-lang');
    if (_inputLangSel) {
        _inputLangSel.addEventListener('change', function () {
            // Always update the HUD label, even when not live
            updateTranscriptionLabel();

            if (!onAir) return;

            // 1. Raise the flag BEFORE calling stop() so that r.onend will not
            //    attempt to auto-restart the old (dying) instance.
            _langSwitching = true;

            if (recognition) {
                try { recognition.stop(); } catch(ex) {}
                recognition = null;
            }

            // 2. Give the browser ~350 ms to fully tear down the old audio session,
            //    then spawn a completely fresh instance.
            setTimeout(function () {
                _langSwitching = false;

                if (!onAir) return;   // user toggled OFF during the wait — do nothing

                recognition = buildRecognition();
                if (!recognition) { setOnAirUI(false); return; }

                try {
                    recognition.start();
                    updateTranscriptionLabel();
                    var newVal = (document.getElementById('vngrd-input-lang') || {}).value || '?';
                    setStatus('STT: LIVE \u25B6 [' + newVal + ']');
                    if (typeof ghostLog === 'function') ghostLog('STT LANG SWITCH \u2192 ' + newVal, 'ok');
                } catch (e) {
                    setOnAirUI(false);
                    recognition = null;
                    setStatus('STT_ERR: RESTART_FAIL');
                    if (typeof ghostLog === 'function') ghostLog('STT RESTART ERR: ' + e.message, 'crit');
                }
            }, 350);
        });
    }

    /* ── SUB_BG opacity cycle ─────────────────────────────────────────── */
    var _subOpacitySmall = document.querySelector('#btn-sub-opacity small');
    if (btnSubOpacity) {
        btnSubOpacity.addEventListener('click', function () {
            subBgIdx = (subBgIdx + 1) % subBgLevels.length;
            subBgOpacity = subBgLevels[subBgIdx];
            var pct = Math.round(subBgOpacity * 100);
            if (_subOpacitySmall) _subOpacitySmall.textContent = pct + '%';
            btnSubOpacity.classList.toggle('active-mode', subBgOpacity > 0);
            renderSubtitles(); // re-apply to live lines
        });
    }

    /* ── P2P STT source toggle ────────────────────────────────────────── */
    var _p2pSttSmall = document.getElementById('p2p-stt-sub');
    if (btnP2pStt) {
        btnP2pStt.addEventListener('click', function () {
            p2pSTTMode = !p2pSTTMode;
            if (_p2pSttSmall) _p2pSttSmall.textContent = p2pSTTMode ? 'P2P' : 'MIC';
            btnP2pStt.classList.toggle('active-mode', p2pSTTMode);

            if (p2pSTTMode && window._p2pAudioStream) {
                // Route P2P remote audio through its own AudioContext path
                // and expose the destination stream for STT consumption.
                try {
                    if (p2pSTTCtx) { p2pSTTCtx.close().catch(function(){}); }
                    p2pSTTCtx = new AudioContext();
                    var src  = p2pSTTCtx.createMediaStreamSource(window._p2pAudioStream);
                    var dest = p2pSTTCtx.createMediaStreamDestination();
                    src.connect(dest);
                    window._p2pSTTStream = dest.stream;
                    if (typeof ghostLog === 'function') {
                        ghostLog('GHOST> P2P AUDIO \u2192 STT PIPELINE ACTIVE', 'ok');
                    }
                } catch (e) {
                    if (typeof ghostLog === 'function') {
                        ghostLog('GHOST> P2P STT ROUTE ERR: ' + e.message, 'crit');
                    }
                }
            } else {
                // Tear down P2P audio context
                if (p2pSTTCtx) { p2pSTTCtx.close().catch(function(){}); p2pSTTCtx = null; }
                window._p2pSTTStream = null;
                if (typeof ghostLog === 'function') {
                    ghostLog('GHOST> STT SOURCE \u2192 LOCAL MIC', 'ai');
                }
            }
        });
    }

    /* ── HARDWARE SCANNER ────────────────────────────────────────────── */
    var scanBtn    = document.getElementById('btn-scan-inputs');
    var inputSelect = document.getElementById('audio-input-select');

    if (scanBtn) {
        scanBtn.onclick = async function() {
            try {
                var tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                await new Promise(function(r) { setTimeout(r, 600); });
                var devices    = await navigator.mediaDevices.enumerateDevices();
                var audioInputs = devices.filter(function(d) { return d.kind === 'audioinput'; });
                if (inputSelect) {
                    inputSelect.innerHTML = '<option value="">SELECT_HARDWARE...</option>';
                    audioInputs.forEach(function(d) {
                        var opt = document.createElement('option');
                        opt.value = d.deviceId;
                        opt.text  = d.label || 'EXTERNAL_INPUT_' + inputSelect.length;
                        inputSelect.appendChild(opt);
                    });
                    inputSelect.style.display = 'block';
                    tempStream.getTracks().forEach(function(t) { t.stop(); });
                }
            } catch (e) { if (typeof ghostLog === 'function') ghostLog('SCAN_ERR: ' + e.message, 'crit'); }
        };
    }

    /* ── Boot ─────────────────────────────────────────────────────────── */
    window.addEventListener('resize', function() { if (window.APP && APP.render) APP.render._cachedRect = null; });
    setStatus('STT: STANDBY');

}());
