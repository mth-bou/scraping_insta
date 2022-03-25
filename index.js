const puppeteer = require('puppeteer')
const ObjectsToCsv = require('objects-to-csv')
const { Cluster } = require('puppeteer-cluster')
require('dotenv').config()

const keyword = "#node"
const user = process.env.USER
const password = process.env.PASSWORD
const filepath = "data.csv";

(async () => {
    // Code d'initialisation du cluster
    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_PAGE,
        maxConcurrency: 4,
        monitor: true,
        timeout: 60000,
        puppeteerOptions: {
            headless: false,
            slowMo: 250,
            args: [`--window-size=${1680},${970}`],
        }
    });

    cluster.on('taskerror', (err, data, willRetry) => {
        if (willRetry) console.warn(`Erreur de scraping, nouvel essai en cours : `);
        else console.error(`Erreur de scraping :`);
        console.log(err);
    });

    await cluster.task(async ({ page, data: elem }) => {
        if (typeof elem.getProfiles !== 'undefined') {
            return await getProfiles(page, elem.getProfiles, cluster)
        }
        else if (typeof elem.getData !== 'undefined') {
            return await getData(page, elem.getData, elem.body, elem.likes)
        }
        else {
            return await getPosts(page)
        }
    });

    try {
        // Code d'installation du scraping
        const results = await cluster.execute('https://www.instagram.com/');
        //console.log(results)
        results.forEach(result => cluster.queue({ getProfiles: result }));
    }
    catch (err) {
        console.log(err)
    }
})()

async function getPosts(page) {
    // step 1 : visit instagram.com site web and accept cookies
    await page.goto('https://www.instagram.com/')
    console.log('-> Recherche bouton cookie')
    const [button2] = await page.$x("//button[contains(., 'Autoriser')]")
    if (button2) {
        console.log('-> Trouve bouton cookie')
        await button2.click()
    }

    // step 2 : fill inputs and valid login
    await page.waitForSelector('input[name="username"]')
    await page.type('input[name="username"]', user)
    await page.type('input[name="password"]', password)

    await Promise.all([
        await page.click('button[type="submit"]'),
        page.waitForNavigation({
            waitUntil: 'networkidle0'
        })
    ]);

    // step 3 : find "Not Now" button for the login save & "Not Now" button to turning off notifications & click on them
    console.log('-> Recherche boutons Not now 1 et Not now 2')
    const [button0] = await page.$x("//button[contains(., 'Plus tard')]");
    if (button0) {
        console.log('-> Trouve bouton Not now')
        await Promise.all([
            await button0.click(),
            page.waitForNavigation({
                waitUntil:  'networkidle0'
            })
        ])
    } else {
        console.log('-> Bouton Not Now 1 non trouvé')
    }

    const [button1] = await page.$x("//button[contains(., 'Plus tard')]");
    if (button1) {
        console.log('-> Trouve bouton Not now 2')
        await Promise.all([
            await button1.click(),
            page.waitForNavigation({
                waitUntil: 'networkidle0'
            })
        ])
    } else {
        console.log('-> Bouton Not now 2 non trouvé')
    }

    // step 4 : find second 'Later' button without loading
    /*console.log('-> Cherche bouton plus tard 2')
    const [button3] = await page.$x("//button[contains(., 'Plus tard')");
    if (button3) {
        console.log('-> Trouve bouton plus tard 2')
        await button3.click()
    } else {
        console.log('-> Bouton plus tard 2 non trouvé')
    }*/

    // step 5 : add more delay + fill the keyword in searchbar & wait the suggestions loading (display loading autocomplete icon)
    console.log('-> Délai de sécurité')
    await page.waitForTimeout(2000)
    console.log('-> SEARCH : typing search')
    await page.type('input[placeholder="Search"]', keyword)
    await page.waitForSelector('div.coreSpriteSearchClear')

    // step 6 : press Tab 2 times then press Enter and wait until the end loading
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    console.log('-> Appuyer sur Entrer - RECHERCHE')
    await Promise.all([
        await page.keyboard.press('Enter'),
        page.waitForNavigation({
            waitUntil: 'networkidle0'
        })
    ]);
    console.log('RECHERCHE - Fin du chargement')

    // step 7 : create a new delay and get all hrefs and stock them
    await page.waitForTimeout(2000)
    const hrefs = await page.evaluate(
        () => Array.from(
            document.querySelectorAll('main[role="main"] > article > div:nth-of-type(2) > div > div > div a'),
            a => a.getAttribute('href')
        )
    );

    return hrefs;
}

async function getProfiles(page, url, cluster) {
    // step 8 : Go to profile URL
    await page.goto('https://www.instagram.com' + url)

    const link = await page.$eval("article header div a:not([href*='explore'])", anchor => anchor.getAttribute('href'));

    const selector_body = await page.$x("//h2/../span");
    const text = await page.evaluate(e => e.textContent, selector_body[0]);

    const selector_likes = await page.$x("//button[contains(., 'aime')]//span");
    const likes = await page.evaluate(e => e.textContent, selector_likes[0]);

    // Add a new task to the cluster queue
    await cluster.queue({ getData: link, body: text, likes: likes});

    return link;
}

async function getData(page, url, body, likes) {
    let r = []

    // step 9 : Data extract from html web page
    await page.goto('https://www.instagram.com' + url)
    await page.waitForSelector('h1')
    await page.waitForTimeout(500)
    let selector_nom = await page.$("section > div:first-of-type > h1,h2");
    let nom = await page.evaluate(el => el.innerText, selector_nom)
    let selector_bio = await page.$("main > div > header > section > div:nth-of-type(2) > span")
    let bio = await page.evaluate(el => el.innerText, selector_bio)
    let selector_stats = await page.$$("main > div > header > section > ul > li span span, main > div > header > section > ul > li a span")
    let stats_publi = await page.evaluate(el => el.innerText, selector_stats[0])
    let stats_abonnes = await page.evaluate(el => el.innerText, selector_stats[1])
    let stats_abonnements = await page.evaluate(el => el.innerText, selector_stats[2])

    r.push({
        "post_body": body,
        "post_likes": likes,
        "user_name": nom,
        "user_bio": bio,
        "user_publications": stats_publi,
        "user_abonnes": stats_abonnes,
        "user_abonnements": stats_abonnements
    });
    //console.log(r)

    // Step 10 : Add results to csv file
    let csv = new ObjectsToCsv(r)
    await csv.toDisk(filepath, { append: true })
    return;
}