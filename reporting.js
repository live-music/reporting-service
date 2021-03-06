require('dotenv').config();

const ENV = process.env;
const MONTH = process.argv.slice(2)[0];
const fs = require('fs');
const winston = require('winston');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const Json2csvParser = require('json2csv').Parser;

// const express = require('express');
// const https = require('https');
// const cors = require('cors');
// const bodyParser = require('body-parser');

const vaultOptions = {
    apiVersion: 'v1',
    endpoint: 'https://env.cue.dj:8200',
    token: fs.readFileSync(ENV.VAULT_TOKEN, 'utf8').trim()
};

const Vault = require('node-vault')(vaultOptions);
const models = require('./models');

Vault.read('secret/env').then(vault => {
    const secrets = vault.data;
    const SOUNDEXCHANGE_KEY = secrets.soundexchange_key;

    let TrackHistory;
    let initialized = false;
    const initialize = setInterval(() => {
        models.initialize().then(() => {
            mongoose.connect(secrets.mongo_driver);

            TrackHistory = mongoose.model('TrackHistory');
            initialized = true;
            clearInterval(initialize);
        });
    }, 2000);

    const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
    });

    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function checkISRC(isrc) {
        const obj = {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'x-api-key': SOUNDEXCHANGE_KEY
            },
            body: JSON.stringify({
                searchFields: { isrc }
            })
        };

        const json = await fetch('https://api.soundexchange.com/repertoire/v1_0/recordings/search', obj)
        .then((res) => {
            return res.json();
        })
        .then((resJson) => {
            return resJson;
        });

        return json;
    }

    async function asyncForEach(array, callback) {
        for (let index = 0; index < array.length; index++) {
            await callback(array[index], index, array); // eslint-disable-line
        }
    }

    async function generateReport() {
        // console.log('GENERATING REPORT FOR MONTH: ', moment().subtract(2, 'months').month());
        let startDate;
        let endDate;
        if (MONTH) {
            console.log('GENERATING REPORT FOR MONTH:', MONTH);
            startDate = moment([2019, MONTH - 1]); // Use actual number of month (e.g. January is month 1 in request);
            endDate = moment(startDate).endOf('month');
        } else {
            console.log('GENERATING REPORT FOR CURRENT MONTH');
            startDate = moment().startOf('month');
            endDate = moment().endOf('month');
        }

        await TrackHistory.find({ $and: [
            { timestamp: { $gte: startDate } },
            { timestamp: { $lte: endDate } }
        ] }, async (err2, trackHistory) => {
            const fields = ['NAME_OF_SERVICE', 'FEATURED_ARTIST', 'SOUND_RECORDING_TITLE', 'ISRC', 'ACTUAL_TOTAL_PERFORMANCES'];
            const tracks = [];

            await asyncForEach(trackHistory, async history => {
                if (history.track.isrc && history.listenCount > 0) {
                    let { listenCount } = history;
                    if (history.regionalListens && history.regionalListens.length) {
                        const usListens = history.regionalListens.find(country => country.code === 'US');
                        if (usListens) {
                            if (usListens.listenCount < listenCount) listenCount = usListens.listenCount;
                        } else {
                            listenCount = 0;
                        }
                    }

                    if (listenCount > 0) {
                        if (history.track.soundexchangeArtist && history.track.soundexchangeTitle) {
                            console.log('WRITING: ', history.track.title, history.track.artist);
                            tracks.push({
                                NAME_OF_SERVICE: 'CUE Music',
                                FEATURED_ARTIST: history.track.soundexchangeArtist.replace(' ♦', ', '),
                                SOUND_RECORDING_TITLE: history.track.soundexchangeTitle,
                                ISRC: history.track.isrc,
                                ACTUAL_TOTAL_PERFORMANCES: listenCount,
                            });
                        }
                        // let completed = false;
                        // let tryCount = 0;
                        // while (!completed) {
                        //     // REMOVE CHECK FOR ISRC AND USE EXISTING SOUNDEXCHANGE DATA
                        //     // const isrc = await checkISRC(history.track.isrc); // eslint-disable-line
                        //     // console.log('GETTING ISRC FOR: ', history.track.title, history.track.artist);
                        //     if (isrc.message === 'Limit Exceeded' || isrc.message === 'Too Many Requests') {
                        //         if (tryCount > 3) {
                        //             console.log('issue', isrc);
                        //             logger.error(isrc);
                        //         }

                        //         tryCount += 1;
                        //         await sleep(1000);
                        //     } else {
                        //         completed = true;
                        //     }
                        // }
                    }
                }
            });

            const json2csvParser = new Json2csvParser({ fields });
            const csv = json2csvParser.parse(tracks);

            fs.writeFile(`./reports/SoundExchangeROU-${ startDate.month() + 1 }-${ startDate.format('YYYY') }.csv`, csv, (err) => {
                if (err) console.log(err);
                console.log(`REPORT CREATED FOR MONTH: ${ MONTH }`);
                process.exit();
            });
        }).populate({
            path:   'track',
            select: 'artist title isrc soundexchangeArtist soundexchangeTitle'
        });
    }

    const generating = setInterval(() => {
        if (initialized) {
            generateReport();
            clearInterval(generating);
        }
    }, 1000);

    // function generateRoyaltyReport() {
    //     const startDate = moment().subtract(1, 'months').startOf('month');
    //     const endDate = moment().subtract(1, 'months').endOf('month');

    //     Set.find({
    //         $and: [
    //             { startTime: { $gte: startDate } },
    //             { endTime: { $lte: endDate } }
    //         ]
    //     }, (err2, sets) => {
    //         const fields = ['NAME_OF_SERVICE', 'FEATURED_ARTIST', 'SOUND_RECORDING_TITLE', 'ISRC', 'ACTUAL_TOTAL_PERFORMANCES'];
    //         const tracks = [];
    //         sets.forEach(set => {
    //             set.tracks.forEach(track => {
    //                 if (track && track.track && track.listenCount > 0 && track.track.isrc && track.track.soundexchangeArtist && track.track.soundexchangeTitle) {
    //                     tracks.push({
    //                         NAME_OF_SERVICE: 'CUE Music',
    //                         FEATURED_ARTIST: track.track.soundexchangeArtist,
    //                         SOUND_RECORDING_TITLE: track.track.soundexchangeTitle,
    //                         ISRC: track.track.isrc,
    //                         ACTUAL_TOTAL_PERFORMANCES: track.listenCount,
    //                     });
    //                 }
    //             });
    //         });

    //         const json2csvParser = new Json2csvParser({ fields });
    //         const csv = json2csvParser.parse(tracks);

    //         fs.writeFile(`./reports/SoundExchangeROU-${ startDate.month() + 1 }-${ startDate.format('YYYY') }.csv`, csv, (err) => {
    //             if (err) console.log(err);
    //         });
    //     }).select('tracks')
    //     .populate({
    //         path:   'tracks.track',
    //     });
    // };

    // Notify room subscribers every morning of upcoming sets, check every 15 minutes
    // const interval = 15 * 60 * 1000;
    // const timeUntilInterval = 15 - Number(moment(Math.ceil(Date.parse(new Date()) % interval)).format('mm'));
    // setTimeout(() => {
    //     console.log(`generating report in ${ timeUntilInterval } minutes`);
    //     if (initialized) generateReport();
    //     setInterval(() => {
    //         console.log('generating report...');
    //     }, 60000 * 15);
    // }, 5000); // timeUntilInterval * 100);

    // function verify(token, res, callback) {
    //     try {
    //         const verified = jwt.verify(token.jwt, SERVICE_KEY);
    //         return callback(verified);
    //     } catch (err) {
    //         return res.status(500).json('Authorization error');
    //     }
    // }

    // const app = express();
    // app.use(cors());
    // app.use(bodyParser.json());

    // app.get('/status', (req, res) => {
    //     res.json({
    //         status: initialized ? 'online' : 'uninitialized',
    //     });
    // });

    // const options = {
    //     key:  fs.readFileSync(`${ ENV.CERT_LOCATION }/privkey.pem`, 'utf8'),
    //     cert: fs.readFileSync(`${ ENV.CERT_LOCATION }/fullchain.pem`, 'utf8')
    // };
    // const server = https.createServer(options, app);
    // server.listen(7777);
});
