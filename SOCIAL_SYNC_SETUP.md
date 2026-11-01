# Týdenní aktualizace Asterionu přímo na GitHubu

Workflow: [Asterion social updates](https://github.com/worldofasterion/worldofasterion.github.io/actions/workflows/social-sync.yml).

Je připravený pro pondělí 9:00 v časovém pásmu Europe/Prague. Dokud není repozitářová proměnná `SOCIAL_SYNC_ENABLED` nastavená na `true`, pravidelné načítání je vypnuté. Chybějící klíče se při ručním testu oznámí bez přepsání webu. Původní místní automatizaci vypneme až po úspěšném propojení, testu a prvním ostrém běhu.

## 1. Kam vložit údaje

Otevři [Settings → Secrets and variables → Actions](https://github.com/worldofasterion/worldofasterion.github.io/settings/secrets/actions).

Na kartě **Secrets** přidej pomocí **New repository secret**:

| Název | Co do něj patří |
| --- | --- |
| `PATREON_ACCESS_TOKEN` | Creator's Access Token vlastního API v2 klienta Patreonu |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Dlouhodobý Page Access Token pro stránku Asterionu, nikoli běžný krátkodobý User Token |

Na kartě [Variables](https://github.com/worldofasterion/worldofasterion.github.io/settings/variables/actions) přidej:

| Název | Hodnota |
| --- | --- |
| `FACEBOOK_PAGE_ID` | Číselné ID stránky Asterionu; nejde o jméno AsterionSvet |
| `SOCIAL_SYNC_ENABLED` | Už připravené `false`; na `true` změnit až po úspěšném testu |

Hesla ani tokeny neposílej do chatu, issue nebo souboru v repozitáři. Nezapínej ladicí logování HTTP a neukládej syrové odpovědi API do artefaktů: mohou obsahovat neveřejná data nebo dočasné podpisy odkazů. GitHub Secrets jsou úložiště přístupů pro workflow; hodnoty nepatří do veřejného kódu.

## 2. Patreon

1. Přihlas se ke správnému tvůrčímu účtu AsterionRPG a otevři [Clients & API Keys](https://www.patreon.com/portal/registration/register-clients).
2. Založ vlastní **API v2** klient, například `Asterion website sync`. Jako web uveď `https://worldofasterion.github.io/`. Pokud formulář vyžaduje redirect URI, použij `https://worldofasterion.github.io/`; tento skript nepoužívá přihlašování návštěvníků ani nezachytává OAuth callback.
3. Použij přístup tvůrce k vlastní kampani s čtecími scopes **campaigns** a **campaigns.posts**. Skript nepožaduje seznam patronů, jejich e-maily, adresy, platby ani oprávnění k publikování. Vygenerovaný Creator Token může mít širší přístup, než skript používá; nevkládej ho nikam veřejně.
4. Creator's Access Token vlož do secretu `PATREON_ACCESS_TOKEN`.
5. Pro první zkoušku to stačí. Token má ale omezenou platnost. Pro dlouhodobý bezobslužný provoz dokonči také část **Automatická obnova tokenu** níže; jinak se po expiraci kontrola zastaví a token bude nutné obnovit ručně.

Patreon API označuje veřejnost polem `is_public`. `is_paid` naopak znamená účtovaný příspěvek u kampaně placené za příspěvek, nikoli spolehlivou kontrolu veřejnosti. Proto tento skript kopíruje tělo jen při výslovném `is_public: true`. U publikovaných členských/nejistých příspěvků ukládá pouze název, původní datum, permalink a obecné oznámení; tělo si z API vůbec nevyžádá. Koncepty a budoucí plánované příspěvky vynechá.

### Automatická obnova tokenu (doporučené pro bezobslužný provoz)

Patreon může při obnově vrátit nový access i refresh token. Nestačí uložit nový token jen do paměti jednoho běhu. Proto je obnova volitelná a potřebuje přesně omezený přístup k zápisu nových hodnot do GitHub Secrets.

Přidej další **Secrets**:

| Název | Hodnota |
| --- | --- |
| `PATREON_CLIENT_ID` | Client ID stejného API v2 klienta |
| `PATREON_CLIENT_SECRET` | Client Secret stejného klienta |
| `PATREON_REFRESH_TOKEN` | Creator's Refresh Token stejného klienta |
| `SOCIAL_SECRETS_WRITER` | GitHub fine-grained token popsaný níže |

Na GitHubu vytvoř [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new), Resource owner **worldofasterion**, přístup **Only select repositories → worldofasterion.github.io**, repository permission **Secrets: Read and write**. Ostatní práva nepřidávej; Metadata: Read je implicitní. Token nemá opravňovat k úpravě kódu, organizace nebo jiných repozitářů. Pokud organizace vyžádá schválení tokenu, schval ho jako správce. Zvol rozumnou dobu platnosti a její obnovu si poznamenej. Tento token sice neumožňuje přečíst existující hodnoty secrets, ale může je nahradit: chraň ho stejně jako ostatní klíče.

Jeho hodnotu vlož do `SOCIAL_SECRETS_WRITER`. Na kartě **Variables** změň již připravené `PATREON_AUTO_REFRESH=false` na `true`. Každý ostrý běh pak nejdřív ověří přístup k zápisu secrets, obnoví Patreon tokeny a uloží jejich nové hodnoty přes GitHub CLI se skrytým vstupem. Čtecí režim `check` tokeny nemění. Pokud se zápis nového tokenu nepodaří, workflow skončí chybou a bude nutné Patreon znovu propojit; nic se nevypíše do logu jako náhradní záloha.

## 3. Facebook

1. Otevři [Meta for Developers → My Apps](https://developers.facebook.com/apps/) pod účtem, který má **Facebook access / full control** ke stránce Asterionu.
2. Vytvoř vlastní aplikaci pro práci se svou Facebook Page (use case pro správu stránky / Pages API). Názvy voleb se podle účtu a aktuálního rozhraní Meta liší. Nevybírej pouze Instagram nebo reklamy. Aplikace, uživatel a stránka musí patřit do odpovídajících oprávněných rolí; samotná znalost ID cizí stránky nestačí.
3. V [Graph API Exploreru](https://developers.facebook.com/tools/explorer/) vyber **svou aplikaci** a vytvoř User Access Token s oprávněními **pages_show_list** a **pages_read_engagement**, při autorizaci vyber jen stránku Asterionu. Nejsou potřeba oprávnění k odesílání příspěvků, reklamám, zprávám ani komentářům.
4. V Exploreru ověř `GET /me/accounts?fields=id,name,access_token,tasks`. Vyber správnou stránku a její číselné `id`. Odpověď obsahuje také tajný Page token: nikam ji neposílej ani neukládej veřejně.
5. Pro automatizaci použij **dlouhodobý Page Access Token**, odvozený z dlouhodobého User Tokenu stejné vlastní aplikace. Krátkodobý token z Exploreru není řešení pro týdenní provoz. Dlouhodobost ověř v [Access Token Debuggeru](https://developers.facebook.com/tools/debug/accesstoken/). Výměna tokenu musí proběhnout přímo u Meta; App Secret, User Token ani výsledný Page Token neposílej do chatu. Podle účtu může být potřeba aktivovat Facebook Login pro aplikaci nebo projít požadavky Meta pro daný přístup. Pokud v rozhraní nemáš možnost přechodu na dlouhodobý token, zastav se u tohoto kroku a pokračujme spolu, neobcházej jej náhodným generátorem tokenů.
6. Page token vlož do secretu `FACEBOOK_PAGE_ACCESS_TOKEN`, číselné ID do proměnné `FACEBOOK_PAGE_ID`.

Skript pracuje s Graph API **v26.0**, vlastním `/{page-id}/published_posts` a vyžaduje shodu autora stránky, `is_published=true`, `is_hidden=false` a `privacy.value=EVERYONE`. Pokud Meta pole veřejnosti nevrátí nebo přístup odmítne, aktualizace se zastaví místo hádání. Do katalogu nejdou koncepty, skryté příspěvky, návštěvnické komentáře ani osobní profil. Při prvním skutečném propojení musíme ověřit dostupnost těchto polí pro konkrétní aplikaci a případné aliasy historických odkazů. Testovací fixtures nenahrazují tuto kontrolu.

Dlouhodobý Page token také může být odvolán (změna práv, bezpečnostní událost, odebraná aplikace apod.). Potom jej bude třeba znovu vydat; nelze slíbit přístup bez údržby navždy.

## 4. První test a zapnutí

1. V [Actions → Asterion social updates](https://github.com/worldofasterion/worldofasterion.github.io/actions/workflows/social-sync.yml) zvol **Run workflow → mode: check**.
2. Otevři výsledek běhu. Dokud hlásí „Čeká na propojení účtů“, nejde o dokončenou synchronizaci. Úspěšný `check` musí skutečně načíst obě API. Nesmí přitom publikovat data ani obnovovat tokeny. Přílohy v tomto režimu načte jen do paměti a zkontroluje jejich formát.
3. Dej mi vědět „klíče vložené“ (bez hodnot). Zkontroluji výsledek, případné historické duplicity, veřejnost dat a kompatibilitu API; pak spustíme **mode: update**. To je první skutečné načtení a zveřejnění materiálů.
4. Po ověření novinek na hlavním webu nastav `SOCIAL_SYNC_ENABLED=true` a vypneme zdejší místní automatizaci, aby se aktualizace nespouštěla dvakrát.

Režim **rebuild** pouze vyzkouší sestavení a ověření existujícího webu na GitHub Pages. Nečte sociální účty. Jeho úspěch není důkazem fungujícího Patreonu či Facebooku.

## Co se ukládá a co se při chybě stane

- Změny vznikají v `data/social-cloud.js`, nových souborech `assets/social-materials/` a cache verzi dat v `index.html`. Historicky ručně ověřené datové soubory se nepřepisují. Téma webu se nemění.
- Facebook přidává veřejné články do skupiny **Z Facebooku**, do Novinek a pravého panelu. Patreon přidává oznámení a pouze veřejný obsah do **Veřejně z Patreonu**.
- Každý nový veřejný text má samostatnou bezpečnou HTML kopii ke stažení. Skript umí veřejné inline přílohy/obrázky Patreonu a vlastní foto-přílohy Facebooku, které API skutečně poskytne. Neznámý typ přílohy neschovává pod falešnou příponou. První živý test musí ověřit také dostupnost samostatných PDF/galerií v konkrétní odpovědi API; API nemusí zpřístupňovat vše, co ukazuje web. Historické galerie již ověřené v ručním auditu zůstávají odkazované, neprobíhá jejich hromadné zrcadlení.
- Externí Pinterest galerie a videa nejsou automaticky kompletně zrcadlené. Odkaz na původní příspěvek zůstává dostupný. Obrazové soubory mají rozpoznaný formát, velikost a SHA-256; podepsané adresy médií a tokeny se neukládají do veřejných dat.
- Přílohy se stahují anonymně, bez Bearer tokenu. Povoleny jsou jen zdrojové domény Patreonu/Facebooku, kontrolované i při přesměrování. Limit je 15 MB na soubor, 100 nových příloh a 100 MB na běh. Překročení se oznámí chybou, ne tichým zkrácením importu.
- Selhání jednoho API zablokuje celý nový snapshot; dosavadní katalog se zachová. Chybějící položka není sama o sobě smazáním. Výslovně nově zamčený Patreon už v katalogu neukazuje text a nové spravované kopie se odstraní z aktuální verze. Původní historické archivy a historie Gitu vyžadují případně ruční revizi; čítač `legacy_access_changes` na to upozorňuje.
- Před zápisem se spustí testy. Bez skutečné změny se nevytváří commit. Push nepoužívá force. Po změně workflow výslovně vyžádá Pages build a ověří veřejně nasazená data; pouhý commit nestačí.
- Automatická obnova Patreon tokenů vyžaduje navíc výše uvedenou výslovnou konfiguraci. Změny přístupů či zrušené tokeny je nutné řešit ručně. Nezapínej obecný přístup k osobním zprávám, patronům nebo jiným účtům.
- GitHub může plánovaný běh zpozdit a v neaktivním veřejném repozitáři plánování po 60 dnech pozastavit. Nastav si oznámení selhaných Actions; úspěšné běhy a jejich souhrny jsou v kartě Actions. Sledování neúspěchů není zárukou detekce, pokud GitHub rozvrh sám vypne.

## Odkazy k oficiální dokumentaci

- [Patreon API v2, oprávnění a obnova tokenů](https://docs.patreon.com/)
- [Meta Pages API – začínáme](https://developers.facebook.com/docs/pages-api/getting-started/)
- [Meta – dlouhodobé přístupové tokeny](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/)
- [Oficiální Meta SDK – verze Graph API](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/api.js)
- [GitHub Actions – časování a omezení](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
