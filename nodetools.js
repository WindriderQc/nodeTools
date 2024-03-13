const fs = require('fs').promises
const fsSync = require('fs')    //  for isExisting
const moment = require('moment')

//  TODO : should include socket.js maybe?


exports.readFile = async (filePath) =>{
    try {
        const data = await fs.readFile(filePath);
        console.log(data.toString());
        return data
      } catch (error) {
        console.error(`Got an error trying to read the file: ${error.message}`);
      }
}


exports.deleteFile = async (filePath) =>{
  try {
    await fs.unlink(filePath);
    console.log(`Deleted ${filePath}`);
  } catch (error) {
    console.error(`Got an error trying to delete the file: ${error.message}`);
  }
  /*  Warning: When you delete the file with the unlink() function, it is not sent to your recycle bin or trash can 
           but permanently removed from your filesystem. This action is not reversible, so please be certain that 
           you want to remove the file before executing your code. */
}


exports.moveFile = async (source, destination) =>{  
  try {
    await fs.rename(source, destination);
    console.log(`Moved file from ${source} to ${destination}`);
  } catch (error) {
    console.error(`Got an error trying to move the file: ${error.message}`);
  }
  // filename must be included in destination as rename is supported   TODO:  ptete mettre filename comme parametre a la function
}


exports.saveFile = async (source, destination) =>{  
  try {
    await fs.writeFile(destination, source);
    console.log(`Saved file to ${destination}`);
  } catch (error) {
    console.error(`Got an error trying to save the file: ${error.message}`);
  }
}


// Check is path or file is valid
exports.isExisting = async (path) => {
  if(fsSync.existsSync(path))    return true
  else return false
}


exports.isObjEmpty =  (obj) => {
  for(let i in obj) return false
  return true
}


exports.TimeDiff = (startTime, endTime, format) => {
  startTime = moment(startTime, 'YYYY-MM-DD HH:mm:ss');
  endTime = moment(endTime, 'YYYY-MM-DD HH:mm:ss');
  return endTime.diff(startTime, format);
}


exports.timeSince = (timeStamp, units="second") => {   
    const now = moment()
    const secs = now.diff(timeStamp, units);
    return secs
}


exports.cliError = (err) => {  console.error(`ERROR(${err.code}): ${err.message}`)  }

exports.cliWarning = (err) => {  console.warn(`ERROR(${err.code}): ${err.message}`)  }

exports.cliMsg = (msg) => {    console.log(msg)  }
