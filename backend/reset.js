const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://Frontier:Frontier@cluster0.14ppd0v.mongodb.net/test?retryWrites=true&w=majority&appName=Cluster0')
.then(async () => {
    const Registration = require('./models/Registration');
    await Registration.deleteMany({});
    console.log('Cleared all tournament registration requests.');
    process.exit(0);
});
