const {deepEqual} = require('node:assert').strict;
const {equal} = require('node:assert').strict;
const test = require('node:test');
const {throws} = require('node:assert').strict;

const rangeForDate = require('./../../balances/range_for_date');

const tests = [
  {
    args: {},
    description: 'No month or year returns no restrictions',
    expected: {},
  },
  {
    args: {year: 2019, month: '1'},
    description: 'First month and 2019 year returns Jan 2019',
    expected: {
      after: '2018-12-31T23:59:59.999Z',
      before: '2019-02-01T00:00:00.000Z',
    },
  },
  {
    args: {year: 2019, month: 'Jan'},
    description: 'Jan 2019 year returns Jan 2019',
    expected: {
      after: '2018-12-31T23:59:59.999Z',
      before: '2019-02-01T00:00:00.000Z',
    },
  },
  {
    args: {year: 2019},
    description: 'A year by itself is valid',
    expected: {
      after: '2018-12-31T23:59:59.999Z',
      before: '2020-01-01T00:00:00.000Z',
    },
  },
  {
    args: {month: 'January'},
    description: 'A month by itself is valid',
  },
];

tests.forEach(({args, description, error, expected}) => {
  return test(description, (t, end) => {
    if (!!error) {
      throws(() => rangeForDate(args), new Error(error), 'Got expected error');
    } else if (!args.year && !!args.month) {
      equal(!!rangeForDate(args).after, true, 'Got expected after date');
      equal(!!rangeForDate(args).before, true, 'Got expected before date');
    } else {
      deepEqual(rangeForDate(args), expected, 'Got expected date range');
    }

    return end();
  });
});
