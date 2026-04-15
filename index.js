#!/usr/bin/env node

const express = require("express");
const app = express();
const axios  = require("axios");
// const yargs = require("yargs");
const inquirer = require("inquirer").default;
const send = require(".src/send.js")

// Wrap code in async function to use await
async function main() {
    console.log("WELCOME TO SHAREIT");

    // Initial prompt to get user choice (send or receive)
    const userChoice = await inquirer.prompt([
        {
            type: "input",
            name: "option",
            message: "Type <send> to send files and <recieve> to recieve files"
        }
    ]);

    if(userChoice.option === "send"){
        const filePath = await inquirer.prompt([
            {
                type: "input",
                name: 'file_dir',
                message: "Enter file directory or item directory you want to share"
            }
        ]);
        send(filePath.file_dir);
    }
    else{
        recieve();
    }
}

// Execute main function
main().catch(console.error);