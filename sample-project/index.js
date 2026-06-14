const express = require('express');
const _ = require('lodash');
const axios = require('axios');
const moment = require('moment');
const chalk = require('chalk');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Command } = require('commander');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const minimist = require('minimist');

const { get, debounce, isEmpty, cloneDeep } = _;
const { red, green, blue } = chalk;
const { verify, sign } = jwt;

module.exports = { express, get, debounce, isEmpty, cloneDeep, red, green, blue, verify, sign };
