const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Tournament = require('./models/Tournament');

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(async () => {
        const t = await Tournament.find();
        console.log("Tournaments:");
        t.forEach(x => {
            console.log(x.name, x.date, x.status);
            console.log(new Date(x.date).getTime(), Date.now());
        });
        process.exit(0);
    });
