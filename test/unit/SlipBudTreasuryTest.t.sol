// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {ITreasury} from "contracts/interfaces/ITreasury.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {
    ERC4626,
    ERC20,
    IERC20
} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {MockERC20} from "test/mocks/MockERC20.sol";
import {SlipBudTreasury} from "contracts/SlipBudTreasury.sol";

contract SlipBudTreasuryTest is Test {
    ITreasury itreasury;
    SlipBudTreasury treasury;
    MockERC20 weth;
    MockERC20 token;

    address bot = makeAddr("Bot");
    address owner = makeAddr("Owner");
    function setUp() public {}
}
